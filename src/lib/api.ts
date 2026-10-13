/**
 * Client for the Convex HTTP API (see convex/http.ts).
 *
 * Everything that needs a browser-like User-Agent, PNG unwrapping or CORS happens
 * on the Convex side; this module only talks to our own /api/* endpoints.
 */

const configured = import.meta.env.VITE_CONVEX_SITE_URL;

/** Base URL of the Convex HTTP actions API, e.g. https://<deployment>.convex.site */
export const API_BASE = (configured ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export type StreamInfo = {
  /** Direct upstream URL (informational; not playable from the browser). */
  videoUrl: string;
  /** Absolute, signed URL of the rewritten HLS playlist — hand this to hls.js. */
  playlistUrl: string;
  /** Signed URL of the thumbnail storyboard (VTT), when the page provides one. */
  thumbVttUrl: string | null;
};

/** Resolve a rou.video page URL into a playable playlist URL. */
export async function resolveStream(pageUrl: string): Promise<StreamInfo> {
  if (!API_BASE) {
    throw new ApiError(
      'VITE_CONVEX_SITE_URL 未配置：请把 Convex 部署的 .convex.site 地址写入环境变量后重新构建',
    );
  }

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/api/resolve?url=${encodeURIComponent(pageUrl)}`,
    );
  } catch (error) {
    throw new ApiError(
      `无法连接后端：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body: { error?: string } & Partial<StreamInfo> = await res
    .json()
    .catch(() => ({}) as { error?: string });
  if (!res.ok)
    throw new ApiError(body.error ?? `解析失败（HTTP ${res.status}）`);
  if (!body.playlistUrl) throw new ApiError('后端未返回播放列表地址');

  return {
    videoUrl: body.videoUrl ?? '',
    // The API returns a root-relative path so it works on any deployment origin.
    playlistUrl: body.playlistUrl.startsWith('http')
      ? body.playlistUrl
      : `${API_BASE}${body.playlistUrl}`,
    thumbVttUrl: body.thumbVttUrl
      ? body.thumbVttUrl.startsWith('http')
        ? body.thumbVttUrl
        : `${API_BASE}${body.thumbVttUrl}`
      : null,
  };
}

/** True for pages on rou.video (the only pages the backend will resolve). */
export function isRouPageUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value.trim());
    return (
      protocol === 'https:' &&
      (hostname === 'rou.video' || hostname.endsWith('.rou.video'))
    );
  } catch {
    return false;
  }
}
