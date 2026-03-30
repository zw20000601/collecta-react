export default function ResourceCard({ resource, isFavorite, onToggleFavorite, showFavorite = true, footerSlot = null }) {
  const tags = Array.isArray(resource.tags) ? resource.tags : []

  return (
    <article className="feature-card resource-card">
      <div className="resource-head">
        <div className="resource-meta">
          <span className="resource-chip">{resource.category || '未分类'}</span>
          {resource.is_public ? <span className="resource-chip public">公开</span> : null}
        </div>
        {showFavorite ? (
          <button
            type="button"
            className={`favorite-heart ${isFavorite ? 'active' : ''}`}
            onClick={() => onToggleFavorite && onToggleFavorite(resource)}
            aria-label="收藏"
          >
            ❤
          </button>
        ) : null}
      </div>

      {resource.cover_url ? (
        <div className="resource-cover">
          <img src={resource.cover_url} alt="" />
        </div>
      ) : null}

      <h3 className="resource-title">{resource.title || '未命名资源'}</h3>
      {resource.url ? (
        <a className="resource-link" href={resource.url} target="_blank" rel="noreferrer">
          {resource.url}
        </a>
      ) : (
        <span className="resource-link">链接缺失</span>
      )}
      <p className="resource-note">{resource.note || '暂无备注'}</p>

      {tags.length ? (
        <div className="resource-tags">
          {tags.map((tag) => (
            <span key={`${resource.id}-${tag}`} className="resource-tag">#{tag}</span>
          ))}
        </div>
      ) : null}

      {footerSlot}
    </article>
  )
}
