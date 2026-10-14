// Convex HTTP API for the rouvideo player.
//
//   GET /api/health    – liveness probe
//   GET /api/selftest  – runtime capability report (no secrets echoed)
//   GET /api/resolve   – ?url=<rou.video page> -> stream info + signed playlist path
//   GET /api/media     – ?u=<base64url target>&s=<hmac> -> unwrapped playlist / segment
//
// Docs: https://docs.convex.dev/functions/http-actions
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import {
  HttpError,
  ROU_ORIGIN,
  assertResolvable,
  assertSafeTarget,
  contentTypeFor,
  extractStreamInfo,
  fetchRou,
  isCdnHost,
  isRouHost,
  mediaPath,
  proxySecret,
  rewritePlaylist,
  sign,
  timingSafeEqual,
  unwrapPng,
  b64urlDecode,
} from "./rou";
import {
  assertArchivePath,
  buildFeedPath,
  fetchNodeText,
  getNodeForRequest,
  parseArticle,
  parseCategories,
  parseFeed,
  refreshNode,
  CG51_LANDING,
} from "./cg51";
import { unzlibSync, zlibSync } from "fflate";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

function fail(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  return json({ error: String(error instanceof Error ? error.message : error) }, 502);
}

const http = httpRouter();

http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => json({ ok: true, service: "rouvideo" })),
});

// Reports which primitives this runtime really offers, so a deploy problem is
// diagnosable without guessing. Never returns the secret itself.
http.route({
  path: "/api/selftest",
  method: "GET",
  handler: httpAction(async (_ctx: ActionCtx, req: Request) => {
    const checks: Record<string, unknown> = { requestUrl: req.url };
    try {
      const original = new TextEncoder().encode("#EXTM3U\nselftest\n".repeat(20));
      const restored = unzlibSync(zlibSync(original));
      checks.fflateZlibRoundTrip =
        restored.length === original.length && new TextDecoder().decode(restored).startsWith("#EXTM3U");
    } catch (e) {
      checks.fflateZlibRoundTrip = `failed: ${String(e)}`;
    }
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("selftest"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("x"));
      checks.hmac = new Uint8Array(mac).length === 32;
      checks.digest =
        (await crypto.subtle.digest("SHA-256", new TextEncoder().encode("x"))).byteLength === 32;
    } catch (e) {
      checks.hmac = `failed: ${String(e)}`;
    }
    checks.secretConfigured = proxySecret() !== undefined;
    checks.base64 = b64urlDecode(
      b64urlEncodeSafe("#EXTM3U").replace(/=+$/, ""),
    ) === "#EXTM3U";
    checks.pngUnwrapOnNonPng = unwrapPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).length === 8;
    return json(checks);
  }),
});

function b64urlEncodeSafe(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_");
}

// Resolve a rou.video page into a playable, signed playlist path.
http.route({
  path: "/api/resolve",
  method: "GET",
  handler: httpAction(async (_ctx: ActionCtx, req: Request) => {
    try {
      const pageUrl = new URL(req.url).searchParams.get("url");
      if (!pageUrl) throw new HttpError(400, "missing url parameter");
      const target = assertResolvable(pageUrl);

      const res = await fetchRou(target.toString());
      if (!res.ok) throw new HttpError(502, `upstream page returned ${res.status}`);
      const info = extractStreamInfo(await res.text());

      if (!info.videoUrl) throw new HttpError(502, "page had no videoUrl");
      const videoUrl = new URL(info.videoUrl, ROU_ORIGIN).toString();
      const secret = proxySecret();
      const origin = new URL(req.url).origin;
      // Fail fast here if the CDN does not look like a video CDN, instead of
      // handing the player a URL that will 403 later.
      assertSafeTarget(videoUrl);

      return json({
        videoUrl,
        playlistUrl: await mediaPath(secret, origin, videoUrl),
        thumbVttUrl: info.thumbVTTUrl
          ? await mediaPath(secret, origin, new URL(info.thumbVTTUrl, ROU_ORIGIN).toString())
          : null,
      });
    } catch (error) {
      return fail(error);
    }
  }),
});

// Stream a playlist (rewritten) or a media segment (unwrapped) back to the player.
http.route({
  path: "/api/media",
  method: "GET",
  handler: httpAction(async (_ctx: ActionCtx, req: Request) => {
    try {
      const params = new URL(req.url).searchParams;
      const encoded = params.get("u");
      if (!encoded) throw new HttpError(400, "missing u parameter");
      const target = b64urlDecode(encoded);
      assertSafeTarget(target);

      const secret = proxySecret();
      if (secret) {
        const provided = params.get("s") ?? "";
        if (!timingSafeEqual(provided, await sign(secret, target))) {
          throw new HttpError(403, "bad signature");
        }
      } else {
        // No secret configured: fall back to a host allowlist so this cannot be
        // used as an open proxy. Setting ROU_PROXY_SECRET enables strict checks.
        const host = new URL(target).hostname;
        if (!isRouHost(host) && !isCdnHost(host)) {
          throw new HttpError(403, "host not allowed (set ROU_PROXY_SECRET for signed urls)");
        }
      }

      const res = await fetchRou(target);
      if (!res.ok) throw new HttpError(502, `upstream returned ${res.status}`);
      const payload = unwrapPng(new Uint8Array(await res.arrayBuffer()));
      const contentType = contentTypeFor(payload);

      if (contentType === "application/vnd.apple.mpegurl") {
        const origin = new URL(req.url).origin;
        const text = await rewritePlaylist(
          new TextDecoder().decode(payload),
          target,
          secret,
          origin,
        );
        return new Response(text, {
          status: 200,
          headers: {
            ...CORS,
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
          },
        });
      }

      return new Response(payload.slice().buffer, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": contentType,
          // Segments are immutable; letting the browser keep them avoids re-pulling
          // the same bytes through the deployment.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (error) {
      return fail(error);
    }
  }),
});

// CORS preflight for the /api/* surface.
http.route({
  pathPrefix: "/api/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })),
});

// ------------------------------------------------------------------
// 51吃瓜 (cg51.com) source — node discovery, feed browsing, articles.
// These power the "news → video" side of the merged video-parsing site.
// ------------------------------------------------------------------

// Discover the current content node by decrypting the cg51.com landing config,
// and return the category nav so the UI can build the sidebar.
http.route({
  path: "/api/node",
  method: "GET",
  handler: httpAction(async () => {
    try {
      const info = await refreshNode();
      const home = await fetchNodeText("/");
      const categories = parseCategories(home);
      return json({ ...info, landing: CG51_LANDING, categories });
    } catch (error) {
      return fail(error);
    }
  }),
});

// List feed items for the home page or a category page.
// ?path=/ (or /category/<slug>)  ?page=N  ?node=<override>
http.route({
  path: "/api/feed",
  method: "GET",
  handler: httpAction(async (_ctx: ActionCtx, req: Request) => {
    try {
      const params = new URL(req.url).searchParams;
      const nodeOverride = params.get("node") || undefined;
      const pathRaw = params.get("path") || "/";
      const page = Number(params.get("page") || "1");
      const base = await getNodeForRequest(nodeOverride);
      const feedPath = buildFeedPath(pathRaw, page);
      const html = await fetchNodeText(feedPath, base);
      return json(parseFeed(html, base, feedPath, page));
    } catch (error) {
      return fail(error);
    }
  }),
});

// Resolve an article page into full metadata + media list.
// ?path=/archives/<id>/  ?node=<override>
http.route({
  path: "/api/article",
  method: "GET",
  handler: httpAction(async (_ctx: ActionCtx, req: Request) => {
    try {
      const params = new URL(req.url).searchParams;
      const path = assertArchivePath(params.get("path") || "");
      const base = await getNodeForRequest(params.get("node") || undefined);
      const html = await fetchNodeText(path, base);
      return json(parseArticle(html, base, path));
    } catch (error) {
      return fail(error);
    }
  }),
});

export default http;
