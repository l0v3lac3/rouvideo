import { useEffect, useState } from 'react';
import { Player, type StreamSource } from './Player';
import {
  getArticle,
  type Cg51Article,
  type Cg51BodyBlock,
  type Cg51Rec,
} from '../lib/api';

/**
 * Article detail in the original site's layout: metadata up top, then the
 * ordered body (paragraphs, headings, images, videos and recommendation
 * entries interleaved exactly as on 51吃瓜). Station promo posts (isPromo)
 * render their text but no player.
 *
 * The video source for a `video` block is derived from the parsed article:
 *  - `video.type === 'hls'` → hls.js against the m3u8 directly
 *  - otherwise → progressive `video.src`
 */
function videoSource(v: Cg51Article['video']): StreamSource | null {
  return v
    ? {
        kind: 'url',
        url: v.url,
        type: v.type === 'hls' ? 'hls' : 'mp4',
      }
    : null;
}

function RecCard({
  rec,
  onOpen,
}: {
  rec: Cg51Rec;
  onOpen: (p: string) => void;
}) {
  return (
    <button
      className="rec-card"
      onClick={() => onOpen(rec.path)}
      title={rec.title}
    >
      {rec.cover ? (
        <img className="rec-cover" src={rec.cover} alt="" loading="lazy" />
      ) : null}
      <span className="rec-text">
        <span className="rec-title">{rec.title}</span>
        {rec.desc ? <span className="rec-desc">{rec.desc}</span> : null}
      </span>
    </button>
  );
}

function BodyBlockView({
  block,
  index,
  node,
  path,
  onOpen,
}: {
  block: Cg51BodyBlock;
  index: number;
  node: string;
  path: string;
  onOpen: (p: string) => void;
}) {
  switch (block.type) {
    case 'h': {
      const Tag = (block.level >= 3 ? 'h3' : 'h2') as 'h2' | 'h3';
      return <Tag className="article-heading">{block.text}</Tag>;
    }
    case 'img':
      return (
        <figure className="article-figure">
          <img src={block.url} alt="" loading="lazy" />
        </figure>
      );
    case 'quote':
      return <blockquote className="article-quote">{block.text}</blockquote>;
    case 'video': {
      const source = videoSource(block.video);
      if (!source) return null;
      return (
        <Player
          key={`${node}${path}#${index}${block.video.id || block.video.url}`}
          source={source}
        />
      );
    }
    case 'rec':
      return <RecCard rec={block.rec} onOpen={onOpen} />;
    case 'p':
      return <p className="article-p">{block.text}</p>;
  }
}

export function Article({
  path,
  node,
  onOpenPath,
}: {
  path: string;
  node: string;
  onOpenPath: (path: string) => void;
}) {
  const [article, setArticle] = useState<Cg51Article | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArticle(null);
    setError(null);
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

  // Fallback for the legacy shape (no ordered body): old description+gallery.
  const hasBody = !!article?.body.length;

  return (
    <section className="article">
      {error ? <p className="hint">{error}</p> : null}

      {article ? (
        <>
          <header className="article-header">
            <h1 className="article-title">{article.title}</h1>
            {article.isPromo ? (
              <span className="promo-badge">站点活动 / 广告</span>
            ) : null}
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
          </header>

          {hasBody ? (
            <div className="article-body">
              {article.body.map((block, i) => (
                <BodyBlockView
                  key={i}
                  block={block}
                  index={i}
                  node={article.node}
                  path={path}
                  onOpen={onOpenPath}
                />
              ))}
            </div>
          ) : (
            <>
              {article.description ? (
                <p className="article-desc">{article.description}</p>
              ) : null}
              {videoSource(article.video) ? (
                <Player
                  key={`${article.node}${path}`}
                  source={videoSource(article.video)!}
                />
              ) : (
                <p className="status">该文章没有可解析的视频。</p>
              )}
              {article.images.length ? (
                <div className="gallery">
                  {article.images.map((img, i) => (
                    <figure className="article-figure" key={i}>
                      <img src={img} alt="" loading="lazy" />
                    </figure>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
