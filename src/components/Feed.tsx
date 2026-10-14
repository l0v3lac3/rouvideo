import { useEffect, useState } from 'react';
import { getFeed, type FeedItem, type FeedResult } from '../lib/api';

/** One row in the feed. */
function FeedCard({
  item,
  onOpen,
}: {
  item: FeedItem;
  onOpen: (item: FeedItem) => void;
}) {
  const date = item.published
    ? new Date(item.published).toLocaleDateString('zh-CN')
    : '';
  return (
    <button
      className="feed-card"
      onClick={() => onOpen(item)}
      aria-label={item.title}
    >
      <div className="feed-cover">
        {item.cover ? (
          <img src={item.cover} alt="" loading="lazy" />
        ) : (
          <div className="feed-cover-empty">无封面</div>
        )}
      </div>
      <div className="feed-body">
        <h3 className="feed-title" title={item.title}>
          {item.title}
        </h3>
        <div className="feed-meta">
          {item.categories.slice(0, 3).map((c) => (
            <span className="feed-cat" key={c}>
              {c}
            </span>
          ))}
        </div>
        <div className="feed-foot">
          <span>{date}</span>
          {item.views ? <span>{item.views}万浏览</span> : null}
        </div>
      </div>
    </button>
  );
}

/**
 * Paginated feed (home or category). Fetches through the Convex backend so the
 * browser never needs CORS to the node, and hands a chosen item up to the
 * parent to open as an article.
 */
export function Feed({
  path,
  node,
  onOpen,
}: {
  path: string;
  node: string;
  onOpen: (item: FeedItem) => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FeedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFeed(path, page, node)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, page, node]);

  const totalPages = data?.totalPages ?? 0;

  return (
    <section className="feed">
      <div className="feed-grid">
        {loading && !data
          ? Array.from({ length: 8 }).map((_, i) => (
              <div className="feed-card feed-skeleton" key={i} />
            ))
          : data?.items.map((item) => (
              <FeedCard key={item.id} item={item} onOpen={onOpen} />
            ))}
      </div>

      {error ? <p className="hint">{error}</p> : null}

      {!loading && totalPages > 1 ? (
        <div className="pager">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={page}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1) setPage(Math.min(totalPages, v));
            }}
            aria-label="页码"
          />
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      ) : null}
    </section>
  );
}
