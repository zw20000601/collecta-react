import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { normalizeResource, parseQueryKeyword } from '../lib/resourceUtils'
import { notifyError } from '../lib/notify'
import HeroClouds from '../components/HeroClouds'
import CategoryIcon from '../components/CategoryIcon'
import {
  DEFAULT_RESOURCE_CATEGORIES,
  normalizeResourceCategoryRow,
  withFallbackCategories,
} from '../lib/resourceCategories'

const ALL = '全部'

function toCategoryPath(name) {
  if (name === ALL) return '/categories/all'
  return `/categories/${encodeURIComponent(name)}`
}

export default function Categories() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [resources, setResources] = useState([])
  const [categoryList, setCategoryList] = useState(DEFAULT_RESOURCE_CATEGORIES)
  const [query, setQuery] = useState(params.get('q') || '')
  const [status, setStatus] = useState('加载中...')

  useEffect(() => {
    setQuery(params.get('q') || '')
  }, [params])

  useEffect(() => {
    loadCategoryList()
    loadResources()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('categories-home-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_categories' }, loadCategoryList)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, loadResources)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function loadResources() {
    let result = await supabase
      .from('resources')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false })

    if (result.error && /column .*is_public/i.test(result.error.message || '')) {
      result = await supabase
        .from('resources')
        .select('*')
        .eq('public', true)
        .order('created_at', { ascending: false })
    }

    if (result.error) {
      setResources([])
      setStatus(`读取资源失败：${result.error.message}`)
      notifyError(`读取资源失败：${result.error.message}`)
      return
    }

    setResources((result.data || []).map(normalizeResource))
    setStatus('公开资源已加载')
  }

  async function loadCategoryList() {
    const result = await supabase
      .from('resource_categories')
      .select('id,name,emoji,sort_order,is_active,created_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (result.error) {
      setCategoryList(DEFAULT_RESOURCE_CATEGORIES)
      return
    }

    const rows = (result.data || []).map((item, index) => normalizeResourceCategoryRow(item, index))
    setCategoryList(withFallbackCategories(rows))
  }

  function onSearchSubmit(event) {
    event.preventDefault()
    const keyword = String(query || '').trim()
    const qs = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
    navigate(`/categories/all${qs}`)
  }

  function getCategoryCount(name) {
    if (name === ALL) return resources.length
    return resources.filter((item) => String(item.category || '').trim() === name).length
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
