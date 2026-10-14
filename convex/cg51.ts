/**
 * Parsers and node resolution for the 51吃瓜 (cg51.com) source.
 *
 * How the source works (all verified empirically, 2026-10-14):
 *  - cg51.com is a *landing/redirector*, not a content host. Its page embeds
 *    a `window.appConfig = { data: "<base64>", key: "<string>" }` payload that
 *    is AES-CBC encrypted with key `SHA256(key)`. The plaintext is JSON with
 *    `main` (the current content node), `domain[]` (mostly ad landers) and
 *    `backup_domain`.
 *  - `main` currently points at https://www.51ql1.com, which 301-redirects to
 *    https://51qingliang.com/ ("51吃瓜轻量版") — the real content node.
 *  - The content node serves:
 *      feed:  /            (page N > 1: /page/N/)
 *      cats:  /category/<slug>/     (page N > 1: /category/<slug>/N/)
 *      post:  /archives/<id>/
 *  - Every asset the player needs is browser-friendly: the node, the video
 *    CDN (hls.tpbbwcc.cn / tx.doudou520.online) and the image CDN
 *    (pic.jtzatly.cn) all answer with `Access-Control-Allow-Origin: *`, need
 *    no User-Agent, and serve *raw* HLS/TSG/JPGE — no PNG container, no
 *    `ev` payload. Only the cg51.com landing page has no CORS headers, which
 *    is the one step that must happen server-side.
 *  - The article page embeds the stream in
 *    `<div class="dplayer" data-config='{"video":{"url":"...m3u8","type":"hls"},...}'>`
 *    with a *fresh* auth_key on every page render, so the article is re-fetched
 *    server-side each time it is opened.
 */
import { HttpError } from "./rou";

export const CG51_LANDING = "https://cg51.com";
export const DEFAULT_NODE = "https://51qingliang.com";

/** Node base URL used by /api/feed and /api/article (set by /api/node). */
let cachedNode: string | null = null;

export function getNode(): string {
  return cachedNode || DEFAULT_NODE;
}

/**
 * Resolve the node to serve a request. Uses an explicit override when given,
 * else the cached node, else a fresh discovery. Module-level `cachedNode` only
 * survives within a single Convex action invocation, so cross-request callers
 * (the frontend) should pass `node` explicitly for speed/consistency; this
 * keeps the API self-sufficient when they don't.
 */
export async function getNodeForRequest(
  override: string | null | undefined,
): Promise<string> {
  if (override) return override.replace(/\/+$/, "");
  if (cachedNode) return cachedNode;
  const info = await refreshNode();
  return info.node;
}

/** Re-run node discovery and remember the result for this runtime. */
export async function refreshNode(): Promise<NodeInfo> {
  const info = await resolveNode();
  cachedNode = info.node;
  return info;
}

export type NodeInfo = {
  /** Content node base URL to use for feeds/articles (no trailing slash). */
  node: string;
  /** Where the node URL came from: "api" (freshly decrypted) or "default". */
  source: "api" | "default";
  /** Value of `main` from the decrypted landing config, if present. */
  main: string | null;
  /** Other listed domains (mostly ad/backup landers — informational). */
  domains: string[];
};

const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchText(target: string, referer: string | undefined): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": BROWSER_UA, Referer: referer ?? "", Accept: "*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new HttpError(502, `upstream returned ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Node discovery
 * ------------------------------------------------------------------ */

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function latin1Decode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

async function sha256Bytes(text: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}

/**
 * AES-256-CBC decrypt with key = SHA256(keyString). The plaintext is JSON whose
 * length is NOT always PKCS7-padded, so try parsing the full plaintext first
 * and only fall back to stripping the last `pad` bytes.
 */
export async function decryptCg51Config(
  dataB64: string,
  key: string,
): Promise<Record<string, unknown>> {
  const dec = base64ToBytes(dataB64);
  const iv = dec.subarray(0, 16);
  const ct = dec.subarray(16);
  const akey = await crypto.subtle.importKey(
    "raw",
    await sha256Bytes(key),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-CBC", iv }, akey, ct),
  );
  // Try full plaintext first; if that fails, strip a PKCS7-style pad.
  const full = latin1Decode(pt);
  try {
    return JSON.parse(full);
  } catch {
    const pad = pt[pt.length - 1];
    if (pad >= 1 && pad <= 16) {
      return JSON.parse(latin1Decode(pt.subarray(0, pt.length - pad)));
    }
    throw new HttpError(502, "failed to decode decrypted config");
  }
}

/** Pull `window.appConfig = { data, key }` out of a cg51.com landing page. */
export function extractCg51Config(html: string): { data: string; key: string } {
  // The active line is NOT `//`-prefixed; the commented decoys start with `//`.
  // A line-anchored `^\s*data:` (with /m) therefore skips the decoys.
  const data = html.match(/^(\s*)data:\s*"([A-Za-z0-9+/=]+)"/m);
  const key = html.match(/^(\s*)key:\s*"([\w]+)"/m);
  if (!data || !key) throw new HttpError(502, "appConfig not found on cg51.com");
  return { data: data[2], key: key[2] };
}

function looksLikeContentNode(html: string): boolean {
  return (
    html.includes('itemtype="http://schema.org/BlogPosting"') ||
    html.includes('"/category/')
  );
}

/**
 * Discover the current content node: decrypt the cg51.com landing config,
 * follow `main` through redirects, and verify the destination is a real
 * content node. Falls back to the known-good default when anything fails.
 */
export async function resolveNode(): Promise<NodeInfo> {
  const fallback: NodeInfo = {
    node: DEFAULT_NODE,
    source: "default",
    main: null,
    domains: [],
  };
  try {
    const html = await fetchText(CG51_LANDING, undefined);
    const cfg = extractCg51Config(html);
    const config = await decryptCg51Config(cfg.data, cfg.key);
    const main =
      typeof config.main === "string" ? config.main : null;
    const domains: string[] = Array.isArray(config.domain)
      ? (config.domain as Array<{ value?: string }>).map(d => d.value ?? "")
      : [];
    let node = main && main.startsWith("http") ? main : DEFAULT_NODE;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(node, {
        headers: { "User-Agent": BROWSER_UA },
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (res.ok && res.url && new URL(res.url).pathname === "/") {
        node = new URL(res.url).origin;
      }
      clearTimeout(timer);
      const home = await fetchText(node + "/", node + "/");
      if (!looksLikeContentNode(home)) throw new Error("not a content node");
    } catch {
      return fallback;
    }
    return { node, source: "api", main, domains };
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * Feed / list parsing
 * ------------------------------------------------------------------ */

export type FeedItem = {
  id: string;
  url: string;
  title: string;
  cover: string;
  published: string;
  author: string;
  categories: string[];
  views: string;
};

export type FeedResult = {
  node: string;
  path: string;
  page: number;
  totalPages: number;
  items: FeedItem[];
};

export type Cg51Category = { slug: string; name: string };

/** Category slugs+names from the node home page nav. */
export function parseCategories(html: string): Cg51Category[] {
  const seen = new Map<string, string>();
  for (const m of html.matchAll(/href="\/category\/([a-z0-9]+)\/?"[^>]*>\s*([^<]{1,20})</g)) {
    const slug = m[1];
    const name = m[2].trim();
    if (!seen.has(slug) && name && !name.includes("category")) seen.set(slug, name);
  }
  return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
}

/**
 * Build the feed URL path for a given list path + page number.
 *  /            page 1 → /          page N → /page/N/
 *  /category/x  page 1 → /category/x/   page N → /category/x/N/
 * Anything else is rejected (the feed is only browsable by home + categories).
 */
export function buildFeedPath(path: string, page: number): string {
  let p = path || "/";
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+$/, "");
  if (page <= 1) return p === "" ? "/" : p + "/";
  if (p === "") return `/page/${page}/`;
  if (/^\/category\/[a-z0-9]+$/.test(p)) return `${p}/${page}/`;
  throw new HttpError(400, "unsupported feed path (use / or /category/<slug>)");
}

const ARTICLE_BLOCK = /<article itemscope itemtype="http:\/\/schema.org\/BlogPosting"[\s\S]*?<\/article>/g;
const ARCHIVE_PATH = /itemprop="url mainEntityOfPage" content="(\/archives\/\d+\/)"/;

/** Parse one feed/list page (home or category) into items + total pages. */
export function parseFeed(html: string, node: string, path: string, page: number): FeedResult {
  const base = node.replace(/\/+$/, "");
  const items: FeedItem[] = [];
  for (const block of html.match(ARTICLE_BLOCK) ?? []) {
    const url = block.match(ARCHIVE_PATH);
    if (!url) continue;
    const title = block.match(/itemprop="headline">\s*([^<]+?)\s*</);
    const cover = block.match(/loadBannerDirect\('([^']+)'/) ?? block.match(/data-xkrkllgl="([^"]+)"/);
    const pub = block.match(/itemprop="datePublished" content="([^"]+)"/);
    // Author: 51qingliang puts it inline ("瓜瓜 • "), 51cg1 in a display-none meta.
    const author =
      block.match(/itemprop="author"[^>]*>\s*([^<]+?)\s*•/) ??
      block.match(
        /itemprop="author" itemtype="http:\/\/schema.org\/Person">\s*<meta itemprop="name" content="([^"]*)"/,
      );
    // Category span is the span right after the datePublished span (no bullets
    // on one skin, a trailing "• " on the other — strip bullets below).
    const cats = block.match(
      /itemprop="datePublished" content="[^"]*"[^>]*>[^<]*<\/span>\s*<span>([^<]*?)<\/span>/,
    );
    const views = block.match(/<span>([\d.]+)万?浏览量<\/span>/);
    const id = url[1].match(/\d+/)?.[0] ?? "";
    const coverUrl = cover?.[1] ?? "";
    items.push({
      id,
      url: `${base}${url[1]}`,
      title: title ? title[1].trim() : "",
      cover: coverUrl.startsWith("http") ? coverUrl : coverUrl ? `${base}${coverUrl}` : "",
      published: pub?.[1] ?? "",
      author: author?.[1].trim() ?? "",
      // The span right after the date is the category list on both skins; guard
      // against a skin that places the views span there instead.
      categories: cats
        ? cats[1]
            .replace(/[•]/g, "")
            .split(",")
            .map(c => c.trim())
            .filter(Boolean)
        : [],
      // keep the raw count ("8.4万" reads nicer than 84000); empty on some skins
      views: views ? views[1] : "",
    });
  }
  let totalPages = 0;
  for (const m of html.matchAll(/\/(?:page|category\/[a-z0-9]+)\/(\d+)\//g)) {
    totalPages = Math.max(totalPages, Number(m[1]));
  }
  return { node: base, path, page, totalPages, items };
}

/* ------------------------------------------------------------------ *
 * Article parsing
 * ------------------------------------------------------------------ */

export type Cg51Video = {
  url: string;
  /** "hls" or "mp4" (video_h265 entries may hold mp4/other). */
  type: string;
  /** Upstream video id (data-video_id), if present. */
  id: string;
};

export type Cg51Article = {
  node: string;
  url: string;
  title: string;
  description: string;
  author: string;
  published: string;
  modified: string;
  categories: string[];
  tags: string[];
  cover: string;
  images: string[];
  video: Cg51Video | null;
};

/**
 * Extract `data-config='{...}'` — the attribute is single-quoted JSON. Prefer
 * the first closing quote; if that JSON is unparseable (a stray `'` inside a
 * string), rescan for the attribute terminator `'}>'`.
 */
function extractDplayerConfig(attrs: string): Record<string, unknown> | null {
  const start = attrs.indexOf("data-config='");
  if (start < 0) return null;
  const begin = start + "data-config='".length;
  const firstEnd = attrs.indexOf("'", begin);
  const candidates = [
    firstEnd > begin ? attrs.slice(begin, firstEnd) : null,
    attrs.slice(begin, attrs.indexOf("'>", begin)) .replace(/'>$/, "") || null,
  ];
  for (const cand of candidates) {
    if (!cand) continue;
    try {
      return JSON.parse(cand) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

/** Parse an /archives/<id>/ page into full metadata + media list. */
export function parseArticle(html: string, node: string, path: string): Cg51Article {
  const base = node.replace(/\/+$/, "");
  const url = `${base}${path}`;

  // og:title is the clean title; <title> carries a site suffix that varies
  // by node skin (" - 51吃瓜轻量版" / " | 51吃瓜网"), so prefer og:title.
  const ogTitle = html.match(/property="og:title" content="([^"]*)"/);
  const titleTag = html.match(/<title>([^<]*)<\/title>/);
  let title = ogTitle?.[1]?.trim() ?? (titleTag ? titleTag[1].trim() : "");
  title = title.replace(/\s*[-|]\s*51吃瓜(轻量版|网).*$/, "").trim();

  const og = html.match(/property="og:description" content="([^"]*)"/);
  const desc = og ? og[1] : "";

  // Author: schema.org Person, falling back to the display-none author meta
  // (the two node skins emit different shapes).
  const author =
    html.match(/"author":\s*\{\s*"@type":\s*"Person",\s*"name":\s*"([^"]*)"/) ??
    html.match(
      /itemprop="author" itemtype="http:\/\/schema.org\/Person">\s*<meta itemprop="name" content="([^"]*)"/,
    );

  const published =
    html.match(/"datePublished":\s*"([^"]*)"/) ??
    html.match(/property="article:published_time" content="([^"]*)"/);
  const modified = html.match(/"dateModified":\s*"([^"]*)"/);

  // articleSection is an array on one skin, a single string on the other.
  const sectionsArr = html.match(/"articleSection":\s*\[([^\]]*)\]/);
  const sectionsStr = html.match(/"articleSection":\s*"([^"]*)"/);
  const categories = sectionsArr
    ? [...sectionsArr[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
    : sectionsStr?.[1]
      ? [sectionsStr[1]]
      : [];

  const dplayerTag = html.match(/class="dplayer"([^>]*)/)?.[1] ?? "";
  const tagsFromVideo = dplayerTag.match(/data-video_tag_name="([^"]*)"/);
  const metaKeywords = html.match(/name="keywords" content="([^"]*)"/);
  const tagSource = tagsFromVideo?.[1] ?? metaKeywords?.[1] ?? "";
  const tags = tagSource.split(",").map(t => t.trim()).filter(Boolean);

  const images = [...html.matchAll(/data-xkrkllgl="(https:\/\/[^"]+)"/g)].map(m => m[1]);
  const cover = images[0] ?? "";

  let video: Cg51Video | null = null;
  const cfg = extractDplayerConfig(dplayerTag);
  if (cfg) {
    const vid = dplayerTag.match(/data-video_id="(\d+)"/)?.[1] ?? "";
    const v = cfg["video"] as { url?: string; type?: string } | undefined;
    if (v?.url) {
      video = { url: v.url, type: v.type ?? "hls", id: vid };
    } else {
      const h265 = (cfg["video_h265"] as Array<{ url?: string; type?: string }>) ?? [];
      const alt = h265.find(h => h?.url);
      if (alt?.url) video = { url: alt.url, type: alt.type ?? "mp4", id: vid };
    }
  }

  return {
    node: base,
    url,
    title,
    description: desc,
    author: author?.[1] ?? "",
    published: published?.[1] ?? "",
    modified: modified?.[1] ?? "",
    categories,
    tags,
    cover,
    images,
    video,
  };
}

/** Fetch a path on the current content node with a browser UA. */
export async function fetchNodeText(path: string, node: string | null = null): Promise<string> {
  const base = (node || getNode()).replace(/\/+$/, "");
  return fetchText(base + path, base + "/");
}

/** Validate an /archives/<id>/ path (the only article shape we resolve). */
export function assertArchivePath(raw: string): string {
  let p = raw;
  // Accept a full URL on a known node and reduce it to the path.
  try {
    if (p.startsWith("http")) {
      const u = new URL(p);
      p = u.pathname;
    }
  } catch {
    throw new HttpError(400, "invalid path");
  }
  if (!/^\/archives\/\d+\/$/.test(p)) {
    throw new HttpError(400, "article path must look like /archives/123/");
  }
  return p;
}
