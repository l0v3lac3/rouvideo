import { useEffect, useState } from 'react';
import { Player, type StreamSource } from './Player';
import { getArticle, type Cg51Article } from '../lib/api';

/**
 * Article detail: full metadata, tags, image gallery and the video player.
 * The video source is derived from the parsed article:
 *  - `video.type === 'hls'` → hls.js against the m3u8 directly
 *  - otherwise → progressive `video.src`
 */
export function Article({ path, node }: { path: string; node: string }) {
  const [article, setArticle] = useState<Cg51Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setArticle(null);
    setError(null);
    setActiveImage(0);
    getArticle(path, node)
      .then((res) => {
        if (!cancelled) setArticle(res);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path, node]);

  const source: StreamSource | null = article?.video
    ? {
        kind: 'url',
        url: article.video.url,
        type: article.video.type === 'hls' ? 'hls' : 'mp4',
      }
    : null;

  return (
    <section className="article">
      {error ? <p className="hint">{error}</p> : null}

      {article ? (
        <>
          <header className="article-header">
            <h1 className="article-title">{article.title}</h1>
            <dl className="article-meta">
              {article.author ? (
                <>
                  <dt>作者</dt>
                  <dd>{article.author}</dd>
                </>
              ) : null}
              {article.published ? (
                <>
                  <dt>发布</dt>
                  <dd>{new Date(article.published).toLocaleString('zh-CN')}</dd>
                </>
              ) : null}
              {article.categories.length ? (
                <>
                  <dt>栏目</dt>
                  <dd>{article.categories.join(' / ')}</dd>
                </>
              ) : null}
              {article.tags.length ? (
                <>
                  <dt>标签</dt>
                  <dd className="article-tags">
                    {article.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
            {article.description ? (
              <p className="article-desc">{article.description}</p>
            ) : null}
          </header>

          {source ? (
            <Player key={`${article.node}${path}`} source={source} />
          ) : (
            <p className="status">该文章没有可解析的视频。</p>
          )}

          {article.images.length ? (
            <div className="gallery">
              <div className="gallery-main">
                <img src={article.images[activeImage]} alt={article.title} />
              </div>
              <div className="gallery-thumbs">
                {article.images.map((img, i) => (
                  <button
                    key={i}
                    className={i === activeImage ? 'thumb active' : 'thumb'}
                    onClick={() => setActiveImage(i)}
                    aria-label={`查看图片 ${i + 1}`}
                  >
                    <img src={img} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
