/**
 * Shared helpers for the rou.video ad-free proxy.
 *
 * Why a server-side proxy is needed at all (all of this was verified empirically,
 * not assumed):
 *  1. rou.video and its video CDNs answer 403 to requests without a browser-like
 *     `User-Agent` header. Browsers cannot set `User-Agent`, `Referer` or
 *     third-party cookies on media requests, so this cannot be done client-side.
 *  2. Every media response is a *PNG container* smuggling the real payload in a
 *     custom `roUd` chunk (optionally zlib-compressed), so the raw bytes are not
 *     playable and not even parseable as HLS until they are unwrapped.
 *  3. The responses carry no CORS headers, so `fetch`/hls.js in a browser cannot
 *     read them directly.
 *
 * What is deliberately NOT needed: TLS/JA3/JA4 fingerprint impersonation
 * (curl_cffi, impers, cycletls, ...). Plain `fetch` from the Convex runtime is
 * accepted by Cloudflare for these endpoints — tested with a bare UA and with
 * several UA shapes. Adding an impersonation layer here would only add weight.
 */
import { unzlibSync } from "fflate";

/** Browser-like UA. A UA is mandatory; the exact shape is not (all tested shapes pass). */
export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const ROU_ORIGIN = "https://rou.video";

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
/** Custom PNG chunk type 0x726f5564 = ASCII "roUd" (capital U) = 1919898980. */
const ROUD_TYPE = 0x726f5564;

/** Page markup embeds the stream descriptor as: ev:{d:"<base64>",k:<int>} */
const EV_RE = /ev:(?:\$R\[\d+\]=)?\{d:"([A-Za-z0-9+/=]+)",k:(\d+)\}/;

const FETCH_TIMEOUT_MS = 20_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Pull the payload out of a "roUd" PNG container. Returns the input unchanged if it is not one. */
export function unwrapPng(data: Uint8Array): Uint8Array {
  if (data.length < 8) return data;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIG[i]) return data;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 8;
  while (i + 8 <= data.length) {
    const length = view.getUint32(i);
    const type = view.getUint32(i + 4);
    const dataStart = i + 8;
    if (dataStart + length > data.length) break;
    if (type === ROUD_TYPE) {
      const flag = data[dataStart];
      const payload = data.subarray(dataStart + 1, dataStart + length);
      return flag & 1 ? unzlibSync(payload) : payload.slice();
    }
    i = dataStart + length + 4; // advance past data + CRC
  }
  return data;
}

/** Decode `ev:{d,k}`: base64, then subtract k from every byte, then parse the JSON. */
export function decryptEv(d: string, k: number): RouStreamInfo {
  const bin = atob(d);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) - k;
  return JSON.parse(new TextDecoder().decode(bytes)) as RouStreamInfo;
}

export type RouStreamInfo = {
  videoUrl?: string;
  thumbVTTUrl?: string;
};

/** Fetch a rou.video-side URL with the headers the origin insists on. */
export async function fetchRou(target: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(target, {
      headers: {
        "User-Agent": UA,
        Referer: `${ROU_ORIGIN}/`,
        Accept: "*/*",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

const PRIVATE_HOST =
  /^(localhost|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

/** Reject non-https and private/link-local targets (SSRF guard for the media endpoint). */
export function assertSafeTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid url");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "only https targets allowed");
  if (PRIVATE_HOST.test(url.hostname)) throw new HttpError(400, "blocked private host");
  return url;
}

export function isRouHost(host: string): boolean {
  return host === "rou.video" || host.endsWith(".rou.video");
}

/** Video CDNs rotate through hosts like v1.basp65.xyz / v3.gokj68.xyz. */
const CDN_HOST = /^v\d+\.[a-z0-9-]{2,}\.[a-z]{2,}$/i;
export function isCdnHost(host: string): boolean {
  return CDN_HOST.test(host);
}

/** Only rou.video pages may be resolved (the one endpoint that takes user input). */
export function assertResolvable(raw: string): URL {
  const url = assertSafeTarget(raw);
  if (!isRouHost(url.hostname)) throw new HttpError(400, "only rou.video page urls can be resolved");
  return url;
}

/* ------------------------------------------------------------------ *
 * Signing: media URLs are HMAC-signed so this deployment cannot be used
 * as an open proxy by third parties.
 * ------------------------------------------------------------------ */

const SIG_BYTES = 16;

export async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return [...mac.subarray(0, SIG_BYTES)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function b64urlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Absolute URL (on this deployment's own origin) that streams `target` back through
 * this deployment. Absolute — not relative — because the player runs on a different
 * origin (GitHub Pages) than the API, so root-relative URLs would resolve against
 * the page, not the backend.
 */
export async function mediaPath(
  secret: string | undefined,
  origin: string,
  target: string,
): Promise<string> {
  const encoded = b64urlEncode(target);
  const query = secret
    ? `u=${encoded}&s=${await sign(secret, target)}`
    : `u=${encoded}`;
  return `${origin.replace(/\/+$/, "")}/api/media?${query}`;
}

/* ------------------------------------------------------------------ *
 * HLS playlist rewriting
 * ------------------------------------------------------------------ */

const URI_ATTR = 'URI="([^"]+)"';

function resolveAgainst(uri: string, base: string): string {
  return new URL(uri, base).toString();
}

/**
 * Route every URI in a playlist through /api/media, preserving the surrounding markup.
 * Handles bare URI lines (segments, variant playlists) and `URI="..."` attributes
 * (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, EXT-X-PRELOAD-HINT, ...).
 */
export async function rewritePlaylist(
  text: string,
  baseUrl: string,
  secret: string | undefined,
  origin: string,
): Promise<string> {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      out.push(line);
      continue;
    }
    if (!trimmed.startsWith("#")) {
      out.push(await mediaPath(secret, origin, resolveAgainst(trimmed, baseUrl)));
      continue;
    }
    const matches = [...trimmed.matchAll(new RegExp(URI_ATTR, "g"))];
    if (matches.length === 0) {
      out.push(line);
      continue;
    }
    let rebuilt = "";
    let last = 0;
    for (const m of matches) {
      const index = m.index ?? 0;
      rebuilt +=
        trimmed.slice(last, index) +
        `URI="${await mediaPath(secret, origin, resolveAgainst(m[1], baseUrl))}"`;
      last = index + m[0].length;
    }
    out.push(rebuilt + trimmed.slice(last));
  }
  return out.join("\n");
}

/** Sniff a sensible Content-Type for the unwrapped payload. */
export function contentTypeFor(data: Uint8Array): string {
  const head = new TextDecoder().decode(data.subarray(0, 16));
  if (head.startsWith("#EXTM3U")) return "application/vnd.apple.mpegurl";
  if (head.startsWith("WEBVTT")) return "text/vtt";
  if (data[0] === 0x47 && data.length > 188 && data[188] === 0x47) return "video/mp2t";
  if (
    data.length > 8 &&
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  ) {
    return "video/mp4";
  }
  return "application/octet-stream";
}

export function extractStreamInfo(html: string): RouStreamInfo {
  const m = html.match(EV_RE);
  if (!m) throw new HttpError(502, "ev payload not found in page");
  return decryptEv(m[1], Number(m[2]));
}

/** Read the proxy secret. Absent secret => signature checks are skipped (see README). */
export function proxySecret(): string | undefined {
  // Typed through globalThis so this does not depend on @types/node being present;
  // the Convex runtime exposes environment variables as process.env.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.ROU_PROXY_SECRET || undefined;
}
