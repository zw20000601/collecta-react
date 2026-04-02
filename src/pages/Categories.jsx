import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { parseQueryKeyword } from '../lib/resourceUtils'
import { notifyError } from '../lib/notify'
import HeroClouds from '../components/HeroClouds'
import CategoryIcon from '../components/CategoryIcon'
import { normalizeResourceCategoryRow } from '../lib/resourceCategories'

const ALL = '全部'

function toCategoryPath(name) {
  if (name === ALL) return '/categories/all'
  return `/categories/${encodeURIComponent(name)}`
}

async function fetchActiveCategories() {
  const result = await supabase
    .from('resource_categories')
    .select('id,name,emoji,sort_order,is_active,created_at')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (result.error) {
    throw new Error(result.error.message || '读取分类失败')
  }

  return (result.data || [])
    .map((item, index) => normalizeResourceCategoryRow(item, index))
    .filter((item) => item && item.name)
}

async function fetchPublicResourceCategoryRows() {
  let result = await supabase
    .from('resources')
    .select('id,category,is_public')
    .eq('is_public', true)

  if (result.error && /column .*is_public/i.test(result.error.message || '')) {
    result = await supabase
      .from('resources')
      .select('id,category,public')
      .eq('public', true)
  }

  if (result.error) {
    throw new Error(result.error.message || '读取资源失败')
  }

  return (result.data || []).map((item) => ({
    id: item.id,
    category: String(item && item.category ? item.category : '').trim(),
  }))
}

export default function Categories() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [loadErrorShown, setLoadErrorShown] = useState(false)

  useEffect(() => {
    setQuery(params.get('q') || '')
  }, [params])

  const categoriesQuery = useQuery({
    queryKey: ['resource_categories_active'],
    queryFn: fetchActiveCategories,
  })

  const resourceRowsQuery = useQuery({
    queryKey: ['resources_public_category_rows'],
    queryFn: fetchPublicResourceCategoryRows,
  })

  useEffect(() => {
    if (!categoriesQuery.error && !resourceRowsQuery.error) {
      setLoadErrorShown(false)
      return
    }
    if (loadErrorShown) return

    const msg = categoriesQuery.error
      ? `读取分类失败：${categoriesQuery.error.message}`
      : `读取资源失败：${resourceRowsQuery.error.message}`
    notifyError(msg)
    setLoadErrorShown(true)
  }, [categoriesQuery.error, resourceRowsQuery.error, loadErrorShown])

  useEffect(() => {
    const channel = supabase
      .channel('categories-home-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_categories' }, () => {
        queryClient.invalidateQueries({ queryKey: ['resource_categories_active'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, () => {
        queryClient.invalidateQueries({ queryKey: ['resources_public_category_rows'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  function onSearchSubmit(event) {
    event.preventDefault()
    const keyword = String(query || '').trim()
    const qs = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
    navigate(`/categories/all${qs}`)
  }

  const categoryList = categoriesQuery.data || []
  const resources = resourceRowsQuery.data || []
  const isLoading = categoriesQuery.isLoading || resourceRowsQuery.isLoading

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
  let statusText = '公开资源已加载'
  if (isLoading) statusText = '分类与资源加载中...'
  if (!isLoading && !categoryCards.length) statusText = '暂无可展示分类'

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
          <p className="mini-status">{searchHint ? `将按关键词「${query.trim()}」进入列表页 · ${statusText}` : statusText}</p>
        </div>
      </section>

      <section className="section-block alt">
        <div className="container">
          {isLoading ? (
            <div className="cat-skeleton-grid" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={`cat-skeleton-${index}`} className="cat-skeleton-card" />
              ))}
            </div>
          ) : (
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
          )}
        </div>
      </section>
    </main>
  )
}
