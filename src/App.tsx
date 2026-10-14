import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Player, type StreamSource } from './components/Player';
import { Feed } from './components/Feed';
import { Article } from './components/Article';
import {
  getNodeInfo,
  isRouPageUrl,
  type FeedItem,
  type NodeInfo,
} from './lib/api';

type Tab = 'cg51' | 'rou';

/**
 * Two sources, one video-parsing site:
 *  - **51吃瓜 (cg51.com)**: browse the news feed (home or category), open an
 *    article to see its metadata / tags / images and play its video.
 *  - **rou.video**: paste a rou.video page URL and play it ad-free through the
 *    Convex proxy.
 *
 * The cg51 node is discovered server-side (`/api/node`) because the cg51.com
 * landing page sends no CORS headers; everything downstream of that is
 * browser-friendly.
 */
export default function App() {
  const [tab, setTab] = useState<Tab>('cg51');

  // cg51
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [feedPath, setFeedPath] = useState('/');
  const [articlePath, setArticlePath] = useState<string | null>(null);

  // rou
  const [rouUrl, setRouUrl] = useState(
    'https://rou.video/v/cmv62vyig000qs6nio33zzlw3',
  );
  const [rouSource, setRouSource] = useState<string | null>(null);
  const [rouHint, setRouHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNodeInfo()
      .then((info) => {
        if (!cancelled) {
          setNodeInfo(info);
          setNodeError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          // Fall back to the known-good default node so browsing still works.
          setNodeError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const node = nodeInfo?.node;

  const openArticle = (item: FeedItem) => {
    const m = item.url.match(/\/archives\/\d+\/$/);
    if (m) setArticlePath(m[0]);
  };

  const submitRou = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isRouPageUrl(rouUrl)) {
      setRouHint(
        '请输入 rou.video 的视频页链接，形如 https://rou.video/v/xxxxxxxx',
      );
      return;
    }
    setRouHint(null);
    setRouSource(rouUrl);
  };

  const rouStream: StreamSource | null = rouSource
    ? { kind: 'rou', pageUrl: rouSource }
    : null;

  return (
    <main className="app">
      <header className="app-header">
        <h1>🍉 视频解析站</h1>
        <p className="tagline">
          51吃瓜资讯视频 + rou.video 无广告播放 · React + Convex + Vite
        </p>
      </header>

      <nav className="tabs">
        <button
          className={tab === 'cg51' ? 'tab active' : 'tab'}
          onClick={() => setTab('cg51')}
        >
          📰 51吃瓜
        </button>
        <button
          className={tab === 'rou' ? 'tab active' : 'tab'}
          onClick={() => setTab('rou')}
        >
          🎬 rou.video
        </button>
      </nav>

      {tab === 'cg51' ? (
        <section>
          {nodeInfo ? (
            <div className="node-bar">
              <span>节点</span>
              <code>{nodeInfo.node}</code>
              <span className="node-src">
                {nodeInfo.source === 'api' ? '实时解析' : '默认'}
              </span>
            </div>
          ) : null}
          {nodeError ? (
            <p className="hint">节点发现失败（已用默认节点）：{nodeError}</p>
          ) : null}

          {node ? (
            <>
              {!articlePath ? (
                <>
                  <CategoryNav
                    categories={nodeInfo?.categories ?? []}
                    active={feedPath}
                    onSelect={(p) => {
                      setFeedPath(p);
                      setArticlePath(null);
                    }}
                  />
                  <Feed path={feedPath} node={node} onOpen={openArticle} />
                </>
              ) : (
                <Article path={articlePath} node={node} />
              )}
              {articlePath ? (
                <button
                  className="back-btn"
                  onClick={() => setArticlePath(null)}
                >
                  ← 返回列表
                </button>
              ) : null}
            </>
          ) : (
            <p className="status">正在发现内容节点…</p>
          )}
        </section>
      ) : (
        <section>
          <ul className="badges">
            <li>服务端解包 PNG 伪装</li>
            <li>Convex 代理绕过 CORS</li>
            <li>hls.js 直接播放</li>
          </ul>
          <form className="url-bar" onSubmit={submitRou}>
            <input
              value={rouUrl}
              onChange={(e) => setRouUrl(e.target.value)}
              placeholder="粘贴 rou.video 视频页 URL"
              aria-label="rou.video 视频页 URL"
              spellCheck={false}
            />
            <button type="submit">播放</button>
          </form>
          {rouHint ? <p className="hint">{rouHint}</p> : null}
          <Player key={rouSource ?? 'idle'} source={rouStream} />
        </section>
      )}

      <footer className="app-footer">
        <p>
          51吃瓜节点由 <code>cg51.com</code>{' '}
          落地页解密得到（AES-CBC，服务端完成）， 其页面/视频/图片 CDN 均开放
          CORS，浏览器直接播放，无需代理。
        </p>
        <p>
          rou.video 要求浏览器 UA、载荷被 PNG 包裹且无 CORS 头，因此抓取与解包在
          Convex 服务端完成（<code>/api/resolve</code>、<code>/api/media</code>
          ）。
        </p>
      </footer>
    </main>
  );
}

function CategoryNav({
  categories,
  active,
  onSelect,
}: {
  categories: NodeInfo['categories'];
  active: string;
  onSelect: (path: string) => void;
}) {
  const homeActive = active === '/' || active === '';
  return (
    <div className="cat-nav">
      <button
        className={homeActive ? 'cat active' : 'cat'}
        onClick={() => onSelect('/')}
      >
        全部
      </button>
      {categories.map((c) => {
        const p = `/category/${c.slug}/`;
        return (
          <button
            key={c.slug}
            className={active === p ? 'cat active' : 'cat'}
            onClick={() => onSelect(p)}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
