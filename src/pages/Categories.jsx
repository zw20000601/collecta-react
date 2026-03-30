import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parseQueryKeyword } from '../lib/resourceUtils'
import { notifyError } from '../lib/notify'
import HeroClouds from '../components/HeroClouds'
import CategoryIcon from '../components/CategoryIcon'
import {
  DEFAULT_RESOURCE_CATEGORIES,
  normalizeResourceCategoryRow,
  withFallbackCategories,
} from '../lib/resourceCategories'

const ALL = '全部'
const CATEGORY_RESOURCES_CACHE_KEY = 'collecta:categories-public-counts:v3'
const CATEGORY_LIST_CACHE_KEY = 'collecta:resource-categories:v1'
const CATEGORY_REFRESH_DEBOUNCE_MS = 320

function toCategoryPath(name) {
  if (name === ALL) return '/categories/all'
  return `/categories/${encodeURIComponent(name)}`
}

export default function Categories() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const refreshTimerRef = useRef(null)
  const resourcesRef = useRef([])

  const [resources, setResources] = useState([])
  const [categoryList, setCategoryList] = useState(DEFAULT_RESOURCE_CATEGORIES)
  const [query, setQuery] = useState(params.get('q') || '')
  const [status, setStatus] = useState('加载中...')

  useEffect(() => {
    setQuery(params.get('q') || '')
  }, [params])

  useEffect(() => {
    resourcesRef.current = resources
  }, [resources])

  const loadResources = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent)
    if (!silent) setStatus('正在同步公开资源...')

    let result = await supabase
      .from('resources')
      .select('id,category,is_public,public')
      .eq('is_public', true)

    if (result.error && /column .*is_public/i.test(result.error.message || '')) {
      result = await supabase
        .from('resources')
        .select('id,category,is_public,public')
        .eq('public', true)
    }

    if (result.error) {
      const msg = `读取资源失败：${result.error.message}`
      setStatus(msg)
      if (!resourcesRef.current.length) setResources([])
      notifyError(msg)
      return
    }

    const nextResources = (result.data || []).map((item) => ({
      id: item.id,
      category: String(item && item.category ? item.category : '').trim(),
    }))
    setResources(nextResources)
    setStatus('公开资源已加载')
    sessionStorage.setItem(
      CATEGORY_RESOURCES_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), resources: nextResources }),
    )
  }, [])

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

  const scheduleResourcesRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      loadResources({ silent: true })
    }, CATEGORY_REFRESH_DEBOUNCE_MS)
  }, [loadResources])

  useEffect(() => {
    const categoryCacheRaw = sessionStorage.getItem(CATEGORY_LIST_CACHE_KEY)
    if (categoryCacheRaw) {
      try {
        const parsed = JSON.parse(categoryCacheRaw)
        const cachedRows = Array.isArray(parsed && parsed.rows) ? parsed.rows : []
        if (cachedRows.length) {
          setCategoryList(withFallbackCategories(cachedRows))
        }
      } catch (_error) {
        sessionStorage.removeItem(CATEGORY_LIST_CACHE_KEY)
      }
    }

    const resourceCacheRaw = sessionStorage.getItem(CATEGORY_RESOURCES_CACHE_KEY)
    if (resourceCacheRaw) {
      try {
        const parsed = JSON.parse(resourceCacheRaw)
        const cachedResources = Array.isArray(parsed && parsed.resources) ? parsed.resources : []
        if (cachedResources.length) {
          setResources(cachedResources)
          setStatus('已加载缓存，正在同步公开资源...')
        }
      } catch (_error) {
        sessionStorage.removeItem(CATEGORY_RESOURCES_CACHE_KEY)
      }
    }

    loadCategoryList()
    loadResources()
  }, [loadCategoryList, loadResources])

  useEffect(() => {
    const channel = supabase
      .channel('categories-home-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_categories' }, loadCategoryList)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, scheduleResourcesRefresh)
      .subscribe()

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [loadCategoryList, scheduleResourcesRefresh])

  function onSearchSubmit(event) {
    event.preventDefault()
    const keyword = String(query || '').trim()
    const qs = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
    navigate(`/categories/all${qs}`)
  }

  const categoryCountMap = useMemo(() => {
    const map = new Map()
    resources.forEach((item) => {
      const key = String(item && item.category ? item.category : '').trim()
      if (!key) return
      map.set(key, (map.get(key) || 0) + 1)
    })
    return map
  }, [resources])

  function getCategoryCount(name) {
    if (name === ALL) return resources.length
    return categoryCountMap.get(name) || 0
  }

  const categoryCards = useMemo(
    () => [{ id: 'all', name: ALL, emoji: '✨' }, ...categoryList],
    [categoryList],
  )

  const searchHint = parseQueryKeyword(query)

  return (
    <main className="page">
      <section className="section-block hero-lite">
        <HeroClouds />
        <div className="container">
          <h1 className="page-title">资源广场</h1>
          <p className="page-subtitle">点击下方分类进入独立列表页，按标签和排序快速查找资源</p>
          <form className="search-bar" onSubmit={onSearchSubmit}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、标签、分类..." />
            <button className="search-btn" type="submit" aria-label="搜索">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </form>
          <p className="mini-status">{searchHint ? `将按关键词「${query.trim()}」进入列表页 · ${status}` : status}</p>
        </div>
      </section>

      <section className="section-block alt">
        <div className="container">
          <div className="cat-grid">
            {categoryCards.map((item) => (
              <button
                key={item.id || item.name}
                type="button"
                className="cat-card"
                onClick={() => {
                  const keyword = String(query || '').trim()
                  const qs = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
                  navigate(`${toCategoryPath(item.name)}${qs}`)
                }}
              >
                <span className="cat-emoji">
                  <span className="cat-emoji-inner">
                    <CategoryIcon value={item.emoji} />
                  </span>
                </span>
                <h4>{item.name}</h4>
                <span>{getCategoryCount(item.name)} 条</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
