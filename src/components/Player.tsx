import type Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { resolveStream, type StreamInfo } from '../lib/api';

type Status = {
  kind: 'idle' | 'busy' | 'ready' | 'error';
  message: string;
};

const IDLE_STATUS: Status = {
  kind: 'idle',
  message: '就绪。粘贴 rou.video 视频页链接后点击播放。',
};

/**
 * HLS player.
 *
 * The playlist URL it loads has already been rewritten by the Convex backend to
 * point at /api/media, so every playlist and segment request goes through the
 * proxy — which is what makes playback possible at all (the origin sends no CORS
 * headers and wraps its payload in a PNG container).
 *
 * Mount it with `key={pageUrl}` so switching videos resets the player state.
 */
export function Player({ pageUrl }: { pageUrl: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>(() =>
    pageUrl ? { kind: 'busy', message: '正在解密视频地址…' } : IDLE_STATUS,
  );
  const [stream, setStream] = useState<StreamInfo | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!pageUrl || !video) return;

    let cancelled = false;
    let hls: Hls | null = null;

    const destroy = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };

    const play = () => {
      void video.play().catch(() => {
        /* autoplay may be blocked by the browser; the controls still work */
      });
    };

    const run = async () => {
      let info: StreamInfo;
      try {
        info = await resolveStream(pageUrl);
      } catch (error) {
        if (!cancelled) {
          setStatus({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (cancelled) return;
      setStream(info);
      setStatus({ kind: 'busy', message: '正在加载视频流…' });

      // hls.js is ~500 kB minified, so it is loaded only when a video is actually
      // requested instead of shipping on first paint.
      const { default: HlsLib } = await import('hls.js');
      if (cancelled) return;

      if (HlsLib.isSupported()) {
        const instance = new HlsLib();
        hls = instance;
        // Exposed for debugging from the browser console (the original script did
        // the same with window.__hls).
        (window as Window & { __hls?: Hls }).__hls = instance;
        if (cancelled) {
          destroy();
          return;
        }
        instance.loadSource(info.playlistUrl);
        instance.attachMedia(video);

        instance.on(HlsLib.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          setStatus({ kind: 'ready', message: '播放就绪' });
          play();
        });

        instance.on(HlsLib.Events.ERROR, (_event, data) => {
          if (cancelled) return;
          setStatus({
            kind: 'error',
            message: `${data.type}: ${data.details}`,
          });
          if (!data.fatal) return;
          if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
            instance.startLoad();
          } else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
            instance.recoverMediaError();
          } else {
            destroy();
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari plays HLS natively.
        video.src = info.playlistUrl;
        video.addEventListener(
          'loadedmetadata',
          () => {
            if (cancelled) return;
            setStatus({ kind: 'ready', message: '播放就绪' });
            play();
          },
          { once: true },
        );
      } else {
        setStatus({ kind: 'error', message: '此浏览器不支持 HLS 播放' });
      }
    };

    void run();

    return () => {
      cancelled = true;
      destroy();
    };
  }, [pageUrl]);

  return (
    <div className="player">
      <div className="video-frame">
        <video ref={videoRef} controls autoPlay playsInline />
      </div>
      <p className={`status status-${status.kind}`}>
        {status.kind === 'ready' ? '✅ ' : ''}
        {status.message}
      </p>
      {stream ? (
        <dl className="details">
          <dt>上游视频流</dt>
          <dd>{stream.videoUrl}</dd>
          <dt>经代理的播放列表</dt>
          <dd>{stream.playlistUrl}</dd>
        </dl>
      ) : null}
    </div>
  );
}
