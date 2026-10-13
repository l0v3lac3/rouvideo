import { useState, type FormEvent } from 'react';
import { Player } from './components/Player';
import { isRouPageUrl } from './lib/api';

const DEMO_URL = 'https://rou.video/v/cmv62vyig000qs6nio33zzlw3';

export default function App() {
  const [input, setInput] = useState(DEMO_URL);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    if (!isRouPageUrl(value)) {
      setHint(
        '请输入 rou.video 的视频页链接，形如 https://rou.video/v/xxxxxxxx',
      );
      return;
    }
    setHint(null);
    setPageUrl(value);
  };

  return (
    <main className="app">
      <header className="app-header">
        <h1>🎬 rouvideo</h1>
        <p className="tagline">
          rou.video 无广告播放器 · React + Convex + Vite
        </p>
      </header>

      <ul className="badges">
        <li>服务端解包 PNG 伪装</li>
        <li>Convex 代理绕过 CORS</li>
        <li>hls.js 直接播放</li>
      </ul>

      <form className="url-bar" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="粘贴 rou.video 视频页 URL"
          aria-label="rou.video 视频页 URL"
          spellCheck={false}
        />
        <button type="submit">播放</button>
      </form>
      {hint ? <p className="hint">{hint}</p> : null}

      <Player key={pageUrl ?? 'idle'} pageUrl={pageUrl} />

      <footer className="app-footer">
        <p>
          播放链路：解析页面并解密 <code>ev</code> 载荷 → HLS 播放列表经{' '}
          <code>/api/media</code> 重写 → 分片解包后回传。上游要求浏览器 UA
          且不返回 CORS 头，因此这些步骤必须在服务端完成。
        </p>
        <p>
          后端接口：<code>/api/resolve</code>、<code>/api/media</code>、
          <code>/api/health</code>、<code>/api/selftest</code>
          （媒体地址带 HMAC 签名，避免被当作公开代理滥用）。
        </p>
      </footer>
    </main>
  );
}
