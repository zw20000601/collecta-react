import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { createResourceSlug, normalizeResource, normalizeTags, parseQueryKeyword } from '../lib/resourceUtils'
import { notifyError, notifyInfo, notifySuccess } from '../lib/notify'
import { DEFAULT_RESOURCE_CATEGORIES, getDefaultCategoryName, normalizeResourceCategoryRow, withFallbackCategories } from '../lib/resourceCategories'

const ALL = '全部'
const PAGE_SIZE = 12
const RESOURCE_REFRESH_DEBOUNCE_MS = 320
const CATEGORY_RESOURCES_CACHE_PREFIX = 'collecta:category-resources:v3'
const CATEGORY_LIST_CACHE_KEY = 'collecta:resource-categories:v1'
const RESOURCE_SELECT_FIELDS = 'id,user_id,title,url,category,tags,note,description,is_public,cover_url,created_at'
const RESOURCE_SELECT_FIELDS_LEGACY = 'id,user_id,title,url,category,tags,note,description,public,cover_url,created_at'

const SORT_OPTIONS = [
  { value: 'latest', label: '最新添加' },
  { value: 'favorites', label: '最多收藏' },
  { value: 'views', label: '最多浏览' },
]

const DEFAULT_FORM = {
  title: '',
  url: '',
  category: '',
  tags: '',
  note: '',
  is_public: false,
}

function decodeCategoryName(value) {
  if (!value || value === 'all') return ALL
  try {
    return decodeURIComponent(value)
  } catch (_error) {
    return value
  }
}

function extractCount(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const num = Number(values[i])
    if (Number.isFinite(num) && num >= 0) return num
  }
  return 0
}

function getResourceDomain(url) {
  try {
    const host = new URL(String(url || '')).hostname || ''
    return host.replace(/^www\./, '') || '未知来源'
  } catch (_error) {
    return '未知来源'
  }
}

function getResourceFavicon(url) {
  const domain = getResourceDomain(url)
  if (domain === '未知来源') return ''
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
}

function normalizeExternalUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}

function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set([1, total, current, current - 1, current + 1])
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b)
}

export default function CategoryResources({ user }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { categoryName } = useParams()
  const [params] = useSearchParams()

  const currentCategory = useMemo(() => decodeCategoryName(categoryName), [categoryName])
  const cacheKey = useMemo(() => `${CATEGORY_RESOURCES_CACHE_PREFIX}:${currentCategory}`, [currentCategory])
  const refreshTimerRef = useRef(null)
  const resourcesRef = useRef([])
  const favoriteCountsRef = useRef({})

  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('加载中...')
  const [resources, setResources] = useState([])
  const [categoryList, setCategoryList] = useState(DEFAULT_RESOURCE_CATEGORIES)
  const [favorites, setFavorites] = useState(new Set())
  const [favoriteCounts, setFavoriteCounts] = useState({})
  const [selectedTags, setSelectedTags] = useState([])
  const [searchKeyword, setSearchKeyword] = useState(params.get('q') || '')
  const [sortBy, setSortBy] = useState(params.get('sort') || 'latest')
  const [page, setPage] = useState(1)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    resourcesRef.current = resources
  }, [resources])

  useEffect(() => {
    favoriteCountsRef.current = favoriteCounts
  }, [favoriteCounts])

  useEffect(() => {
    setSearchKeyword(params.get('q') || '')
    setSortBy(params.get('sort') || 'latest')
  }, [params])

  useEffect(() => {
    setSelectedTags([])
  }, [currentCategory])

  useEffect(() => {
    const raw = sessionStorage.getItem(cacheKey)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      const cachedResources = Array.isArray(parsed && parsed.resources) ? parsed.resources : []
      const cachedFavoriteCounts =
        parsed && parsed.favoriteCounts && typeof parsed.favoriteCounts === 'object'
          ? parsed.favoriteCounts
          : {}
      if (cachedResources.length) {
        setResources(cachedResources)
        setFavoriteCounts(cachedFavoriteCounts)
        setLoading(false)
        setStatus(currentCategory === ALL ? '已加载缓存资源，正在同步...' : `已加载「${currentCategory}」缓存，正在同步...`)
      }
    } catch (_error) {
      sessionStorage.removeItem(cacheKey)
    }
  }, [cacheKey, currentCategory])

  const loadCategoryList = useCallback(async () => {
    const result = await supabase
      .from('resource_categories')
      .select('id,name,emoji,sort_order,is_active,created_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (result.error) {
      const cachedRaw = sessionStorage.getItem(CATEGORY_LIST_CACHE_KEY)
      if (cachedRaw) {
        try {
          const parsed = JSON.parse(cachedRaw)
          const cachedRows = Array.isArray(parsed && parsed.rows) ? parsed.rows : []
          if (cachedRows.length) {
            setCategoryList(withFallbackCategories(cachedRows))
            return
          }
        } catch (_error) {
          sessionStorage.removeItem(CATEGORY_LIST_CACHE_KEY)
        }
      }
      setCategoryList(DEFAULT_RESOURCE_CATEGORIES)
      return
    }

    const rows = (result.data || []).map((item, index) => normalizeResourceCategoryRow(item, index))
    setCategoryList(withFallbackCategories(rows))
    sessionStorage.setItem(CATEGORY_LIST_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), rows }))
  }, [])

  const refreshFavoriteStats = useCallback(
    async (rows, options = {}) => {
      const includeAggregate = Boolean(options.includeAggregate)
      const ids = rows.map((item) => item.id).filter(Boolean)
      if (!ids.length) {
        setFavoriteCounts({})
        setFavorites(new Set())
        return
      }

      const aggregate = {}
      if (includeAggregate) {
        const countResult = await supabase
          .from('favorites')
          .select('resource_id')
          .in('resource_id', ids)

        if (!countResult.error) {
          ;(countResult.data || []).forEach((item) => {
            const key = item.resource_id
            aggregate[key] = (aggregate[key] || 0) + 1
          })
          setFavoriteCounts(aggregate)
        }
      }

      if (!user) {
        setFavorites(new Set())
        return { favoriteCounts: aggregate, favorites: [] }
      }

      const ownResult = await supabase
        .from('favorites')
        .select('resource_id')
        .eq('user_id', user.id)
        .in('resource_id', ids)

      if (ownResult.error) {
        setFavorites(new Set())
        return { favoriteCounts: aggregate, favorites: [] }
      }

      const ownFavorites = (ownResult.data || []).map((item) => item.resource_id)
      setFavorites(new Set(ownFavorites))
      return { favoriteCounts: aggregate, favorites: ownFavorites }
    },
    [user],
  )

  const loadResources = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent)
    if (!silent && !resourcesRef.current.length) setLoading(true)

    let request = supabase
      .from('resources')
      .select(RESOURCE_SELECT_FIELDS)
      .eq('is_public', true)
      .order('created_at', { ascending: false })

    if (currentCategory !== ALL) {
      request = request.eq('category', currentCategory)
    }

    let result = await request

    if (result.error && /column .*is_public/i.test(result.error.message || '')) {
      let fallbackRequest = supabase
        .from('resources')
        .select(RESOURCE_SELECT_FIELDS_LEGACY)
        .eq('public', true)
        .order('created_at', { ascending: false })
      if (currentCategory !== ALL) {
        fallbackRequest = fallbackRequest.eq('category', currentCategory)
      }
      result = await fallbackRequest
    }

    if (result.error) {
      const msg = `读取资源失败：${result.error.message}`
      setStatus(msg)
      if (!resourcesRef.current.length) setResources([])
      notifyError(msg)
      if (!resourcesRef.current.length) setLoading(false)
      return
    }

    const rows = (result.data || []).map(normalizeResource)
    setResources(rows)
    setStatus(currentCategory === ALL ? '已加载全部公开资源' : `已加载「${currentCategory}」分类资源`)
    setLoading(false)
    sessionStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), resources: rows, favoriteCounts: favoriteCountsRef.current }))

    const includeAggregate = sortBy === 'favorites'
    refreshFavoriteStats(rows, { includeAggregate })
      .then((stats) => {
        if (!stats || typeof stats !== 'object') return
        const nextFavoriteCounts = includeAggregate ? stats.favoriteCounts || {} : favoriteCountsRef.current
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            cachedAt: Date.now(),
            resources: rows,
            favoriteCounts: nextFavoriteCounts,
          }),
        )
      })
      .catch(() => {})
  }, [cacheKey, currentCategory, refreshFavoriteStats, sortBy])

  const scheduleRefresh = useCallback((options = {}) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }
    refreshTimerRef.current = setTimeout(() => {
      loadResources({ silent: true, ...options })
    }, RESOURCE_REFRESH_DEBOUNCE_MS)
  }, [loadResources])

  useEffect(() => {
    loadCategoryList()
  }, [loadCategoryList])

  useEffect(() => {
    loadResources()
  }, [loadResources])

  useEffect(() => {
    const channel = supabase
      .channel(`category-resources-sync-${currentCategory}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, () => scheduleRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_categories' }, loadCategoryList)
      .subscribe()

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [currentCategory, loadCategoryList, scheduleRefresh])

  const categoryNames = useMemo(
    () => categoryList.map((item) => item.name).filter(Boolean),
    [categoryList],
  )

  const modalCategoryOptions = useMemo(() => {
    const options = [...categoryNames]
    const current = String(form.category || '').trim()
    if (current && !options.includes(current)) options.unshift(current)
    return options
  }, [categoryNames, form.category])

  const availableTags = useMemo(() => {
    const map = new Map()
    resources.forEach((item) => {
      normalizeTags(item.tags).forEach((tag) => {
        const key = String(tag || '').trim()
        if (!key) return
        map.set(key, (map.get(key) || 0) + 1)
      })
    })
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
      .map(([name, count]) => ({ name, count }))
  }, [resources])

  const selectedTagKey = useMemo(
    () => [...selectedTags].sort().join('|'),
    [selectedTags],
  )

  useEffect(() => {
    setPage(1)
  }, [searchKeyword, sortBy, selectedTagKey, currentCategory])

  function getFavoriteCount(resource) {
    return extractCount(
      favoriteCounts[resource.id],
      resource.favorite_count,
      resource.favorites_count,
      resource.bookmark_count,
      0,
    )
  }

  function getViewCount(resource) {
    return extractCount(
      resource.view_count,
      resource.views_count,
      resource.visit_count,
      resource.views,
      0,
    )
  }

  const filteredSortedResources = useMemo(() => {
    const keyword = parseQueryKeyword(searchKeyword)

    const filtered = resources.filter((item) => {
      const tags = normalizeTags(item.tags)
      if (selectedTags.length) {
        const tagSet = new Set(tags)
        const includeAll = selectedTags.every((tag) => tagSet.has(tag))
        if (!includeAll) return false
      }

      if (!keyword) return true

      const matchPool = [
        String(item.title || '').toLowerCase(),
        String(item.note || '').toLowerCase(),
        String(item.description || '').toLowerCase(),
        String(item.category || '').toLowerCase(),
        getResourceDomain(item.url).toLowerCase(),
        tags.join(' ').toLowerCase(),
      ]

      return matchPool.some((part) => part.includes(keyword))
    })

    const sorted = [...filtered]
    if (sortBy === 'favorites') {
      sorted.sort((a, b) => getFavoriteCount(b) - getFavoriteCount(a))
    } else if (sortBy === 'views') {
      sorted.sort((a, b) => getViewCount(b) - getViewCount(a))
    } else {
      sorted.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    }
    return sorted
  }, [resources, searchKeyword, selectedTags, sortBy, favoriteCounts])

  const totalPages = Math.max(1, Math.ceil(filteredSortedResources.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageItems = filteredSortedResources.slice(pageStart, pageStart + PAGE_SIZE)
  const pageNumbers = getPageNumbers(currentPage, totalPages)

  function toggleTag(tagName) {
    setSelectedTags((prev) => {
      if (prev.includes(tagName)) return prev.filter((item) => item !== tagName)
      return [...prev, tagName]
    })
  }

  function openResourceLink(resource) {
    const href = normalizeExternalUrl(resource && resource.url)
    if (!href) return
    window.location.assign(href)
  }

  async function onToggleFavorite(event, resource) {
    event.preventDefault()
    event.stopPropagation()

    if (!user) {
      notifyInfo('登录后才能收藏')
      const redirect = `${location.pathname}${location.search}`
      navigate(`/login?redirect=${encodeURIComponent(redirect)}`)
      return
    }

    const resourceId = resource.id
    const active = favorites.has(resourceId)

    setFavorites((prev) => {
      const next = new Set(prev)
      if (active) next.delete(resourceId)
      else next.add(resourceId)
      return next
    })

    setFavoriteCounts((prev) => ({
      ...prev,
      [resourceId]: Math.max(0, (prev[resourceId] || 0) + (active ? -1 : 1)),
    }))

    if (active) {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('resource_id', resourceId)

      if (error) {
        setFavorites((prev) => {
          const next = new Set(prev)
          next.add(resourceId)
          return next
        })
        setFavoriteCounts((prev) => ({
          ...prev,
          [resourceId]: (prev[resourceId] || 0) + 1,
        }))
        notifyError(`取消收藏失败：${error.message}`)
        return
      }

      notifySuccess('已取消收藏')
      return
    }

    const { error } = await supabase
      .from('favorites')
      .insert({ user_id: user.id, resource_id: resourceId })

    if (error) {
      setFavorites((prev) => {
        const next = new Set(prev)
        next.delete(resourceId)
        return next
      })
      setFavoriteCounts((prev) => ({
        ...prev,
        [resourceId]: Math.max(0, (prev[resourceId] || 0) - 1),
      }))
      notifyError(`收藏失败：${error.message}`)
      return
    }

    notifySuccess('已加入收藏')
  }

  function openCreateModal() {
    if (!user) return
    setForm({
      ...DEFAULT_FORM,
      category: currentCategory === ALL ? getDefaultCategoryName(categoryList) : currentCategory,
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setSaving(false)
  }

  function onFormChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submitResource(event) {
    event.preventDefault()
    if (!user) return

    const title = String(form.title || '').trim()
    const url = String(form.url || '').trim()
    if (!title || !url) {
      notifyInfo('请完整填写标题和链接')
      return
    }

    const payload = {
      user_id: user.id,
      title,
      url,
      category: String(form.category || '').trim() || getDefaultCategoryName(categoryList),
      tags: normalizeTags(form.tags),
      note: String(form.note || '').trim(),
      description: String(form.note || '').trim() || title,
      is_public: Boolean(form.is_public),
      slug: createResourceSlug(title),
    }

    setSaving(true)
    const { error } = await supabase.from('resources').insert(payload)
    setSaving(false)

    if (error) {
      notifyError(`添加失败：${error.message}`)
      return
    }

    notifySuccess('资源已添加')
    closeModal()
    await loadResources()
  }

  const headerTitle = currentCategory === ALL ? '全部资源' : currentCategory
  const headerCount = resources.length

  return (
    <main className="page">
      <section className="section-block alt category-list-page">
        <div className="container">
          <div className="category-breadcrumb">
            <Link to="/categories">资源广场</Link>
            <span className="sep">&gt;</span>
            <span>{headerTitle}</span>
          </div>

          <div className="category-title-row">
            <h1>{headerTitle}</h1>
            <span className="category-count-badge">{headerCount} 条</span>
          </div>

          <div className="category-filter-bar">
            <div className="category-tags-wrap">
              {availableTags.length ? (
                availableTags.map((tag) => (
                  <button
                    key={tag.name}
                    type="button"
                    className={`category-tag-pill ${selectedTags.includes(tag.name) ? 'active' : ''}`}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name}
                    <em>{tag.count}</em>
                  </button>
                ))
              ) : (
                <span className="category-tags-empty">当前分类暂无标签</span>
              )}
            </div>

            <div className="category-filter-right">
              <label className="category-search-box" aria-label="搜索资源">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="M16 16l4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                <input
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                  placeholder="搜索标题、描述、标签"
                />
              </label>

              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="mini-status">{status}</p>

          {!loading && !resources.length ? (
            <section className="category-empty-state">
              <span className="icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M5 10.2c0-2 1.6-3.7 3.7-3.7h6.6c2 0 3.7 1.6 3.7 3.7v4.5c0 2-1.6 3.7-3.7 3.7H8.7c-2 0-3.7-1.6-3.7-3.7v-4.5Z" stroke="currentColor" strokeWidth="1.8" /><path d="M8.8 11.4h6.4M8.8 14h4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </span>
              <h3>该分类暂无资源</h3>
              <p>可以去留言板提交需求</p>
              <button type="button" className="home-action-btn" onClick={() => navigate('/messages')}>去留言板</button>
            </section>
          ) : null}

          {!loading && resources.length ? (
            <>
              {!filteredSortedResources.length ? (
                <section className="category-empty-state">
                  <h3>没有找到相关资源</h3>
                  <p>可尝试清空标签筛选或调整搜索关键词</p>
                </section>
              ) : (
                <section className="category-resource-grid">
                  {pageItems.map((resource) => {
                    const tags = normalizeTags(resource.tags)
                    const visibleTags = tags.slice(0, 3)
                    const extraCount = Math.max(0, tags.length - visibleTags.length)
                    const domain = getResourceDomain(resource.url)
                    const favoriteCount = getFavoriteCount(resource)
                    const activeFav = favorites.has(resource.id)
                    const summary = String(resource.note || resource.description || '暂无描述').trim()

                    return (
                      <article
                        key={resource.id}
                        className="category-resource-card"
                        onClick={() => openResourceLink(resource)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openResourceLink(resource)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <header className="cr-card-head">
                          <div className="cr-origin">
                            {getResourceFavicon(resource.url) ? (
                              <img src={getResourceFavicon(resource.url)} alt="" />
                            ) : (
                              <span className="cr-fallback-icon">🔗</span>
                            )}
                            <span>{domain}</span>
                          </div>

                          <button
                            type="button"
                            className={`favorite-heart ${activeFav ? 'active' : ''}`}
                            onClick={(event) => onToggleFavorite(event, resource)}
                            aria-label={activeFav ? '取消收藏' : '收藏资源'}
                          >
                            ❤
                          </button>
                        </header>

                        {resource.cover_url ? (
                          <div className="cr-cover">
                            <img src={resource.cover_url} alt="" />
                          </div>
                        ) : null}

                        <h3>{resource.title || '未命名资源'}</h3>
                        <p>{summary}</p>

                        <footer className="cr-card-foot">
                          <div className="cr-tags">
                            {visibleTags.map((tag) => (
                              <span key={`${resource.id}-${tag}`}>#{tag}</span>
                            ))}
                            {extraCount ? <span>+{extraCount}</span> : null}
                          </div>
                          <span className="cr-fav-count">收藏 {favoriteCount}</span>
                        </footer>
                      </article>
                    )
                  })}
                </section>
              )}

              {totalPages > 1 ? (
                <nav className="category-pagination" aria-label="分页">
                  <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage <= 1}>上一页</button>
                  {pageNumbers.map((number) => (
                    <button
                      key={number}
                      type="button"
                      className={number === currentPage ? 'active' : ''}
                      onClick={() => setPage(number)}
                    >
                      {number}
                    </button>
                  ))}
                  <button type="button" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage >= totalPages}>下一页</button>
                </nav>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {modalOpen ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>添加资源</h3>
              <button type="button" className="ghost-btn" onClick={closeModal}>关闭</button>
            </div>

            <form className="modal-form" onSubmit={submitResource}>
              <input value={form.title} onChange={(event) => onFormChange('title', event.target.value)} placeholder="资源标题" required />
              <input value={form.url} onChange={(event) => onFormChange('url', event.target.value)} placeholder="资源链接" required />
              <select value={form.category} onChange={(event) => onFormChange('category', event.target.value)}>
                {modalCategoryOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <input value={form.tags} onChange={(event) => onFormChange('tags', event.target.value)} placeholder="标签（用逗号分隔）" />
              <textarea value={form.note} onChange={(event) => onFormChange('note', event.target.value)} rows={4} placeholder="备注（可选）" />
              <label className="checkbox-row">
                <input type="checkbox" checked={form.is_public} onChange={(event) => onFormChange('is_public', event.target.checked)} />
                公开此资源（游客和其他用户可见）
              </label>

              <div className="modal-actions">
                <button type="submit" className="nav-cta" disabled={saving}>{saving ? '保存中...' : '添加资源'}</button>
                <button type="button" className="ghost-btn" onClick={closeModal}>取消</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  )
}
