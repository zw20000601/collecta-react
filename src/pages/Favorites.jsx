import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { notifyError, notifySuccess } from '../lib/notify'
import { normalizeResource } from '../lib/resourceUtils'
import ResourceCard from '../components/ResourceCard'
import HeroClouds from '../components/HeroClouds'

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function tagsToText(tags) {
  if (Array.isArray(tags)) return tags.join(' ')
  if (typeof tags === 'string') return tags
  return ''
}

async function fetchFavorites(userId) {
  if (!userId) return []

  const { data: rows, error } = await supabase
    .from('favorites')
    .select(`
      id,
      resource_id,
      created_at,
      resource:resources(*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || '读取收藏失败')
  }

  return (rows || [])
    .map((item) => normalizeResource(item && item.resource))
    .filter(Boolean)
}

export default function Favorites({ user }) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sortBy, setSortBy] = useState('latest')

  const userId = user ? user.id : ''

  const favoritesQuery = useQuery({
    queryKey: ['favorites', userId],
    queryFn: () => fetchFavorites(userId),
    enabled: Boolean(userId),
    placeholderData: (prev) => prev,
  })

  const resources = favoritesQuery.data || []
  const loading = favoritesQuery.isLoading

  useEffect(() => {
    if (!favoritesQuery.error) return
    notifyError(`读取收藏失败：${favoritesQuery.error.message}`)
  }, [favoritesQuery.error])

  useEffect(() => {
    if (!userId) return undefined

    const channel = supabase
      .channel(`favorites-sync-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'favorites' }, () => {
        queryClient.invalidateQueries({ queryKey: ['favorites', userId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, () => {
        queryClient.invalidateQueries({ queryKey: ['favorites', userId] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient, userId])

  async function removeFavorite(resource) {
    if (!userId) return

    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('resource_id', resource.id)

    if (error) {
      notifyError(`取消收藏失败：${error.message}`)
      return
    }

    queryClient.setQueryData(['favorites', userId], (prev) => {
      const list = Array.isArray(prev) ? prev : []
      return list.filter((item) => item.id !== resource.id)
    })
    queryClient.invalidateQueries({ queryKey: ['favorites_stats_by_category', userId] })
    notifySuccess('已取消收藏')
  }

  const categoryOptions = useMemo(() => {
    const set = new Set()
    resources.forEach((item) => {
      const name = String(item.category || '').trim()
      if (name) set.add(name)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [resources])

  const filteredResources = useMemo(() => {
    const keyword = normalizeText(query)

    let list = resources.filter((item) => {
      const hitCategory = category === 'all' || String(item.category || '').trim() === category
      if (!hitCategory) return false
      if (!keyword) return true

      const text = [item.title, item.category, item.note, item.url, tagsToText(item.tags)].join(' ').toLowerCase()
      return text.includes(keyword)
    })

    if (sortBy === 'oldest') {
      list = [...list].reverse()
    } else if (sortBy === 'title_asc') {
      list = [...list].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'))
    } else if (sortBy === 'title_desc') {
      list = [...list].sort((a, b) => String(b.title || '').localeCompare(String(a.title || ''), 'zh-CN'))
    }

    return list
  }, [resources, query, category, sortBy])

  function resetFilters() {
    setQuery('')
    setCategory('all')
    setSortBy('latest')
  }

  const status = loading
    ? '加载中...'
    : favoritesQuery.isFetching
    ? '正在同步收藏...'
    : resources.length
    ? '收藏已同步'
    : '还没有收藏资源'

  return (
    <main className="page">
      <section className="section-block hero-lite">
        <HeroClouds />
        <div className="container">
          <h1 className="page-title favorites-title">
            <span>我的收藏夹</span>
            <svg className="favorites-title-heart" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 20.4L10.55 19.08C5.4 14.4 2 11.32 2 7.5C2 4.42 4.42 2 7.5 2C9.24 2 10.91 2.81 12 4.08C13.09 2.81 14.76 2 16.5 2C19.58 2 22 4.42 22 7.5C22 11.32 18.6 14.4 13.45 19.1L12 20.4Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </h1>
          <p className="page-subtitle">共收藏了 {resources.length} 条资源，当前显示 {filteredResources.length} 条</p>

          <div className="favorites-controls">
            <label className="favorites-search" aria-label="搜索收藏资源">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题、标签、分类、备注..."
              />
            </label>

            <label className="favorites-select-wrap">
              <span>分类</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">全部分类</option>
                {categoryOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>

            <label className="favorites-select-wrap">
              <span>排序</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="latest">最新收藏</option>
                <option value="oldest">最早收藏</option>
                <option value="title_asc">标题 A-Z</option>
                <option value="title_desc">标题 Z-A</option>
              </select>
            </label>
          </div>

          <p className="mini-status">{status}</p>
        </div>
      </section>

      <section className="section-block">
        <div className="container">
          {loading ? <div className="empty-box">收藏加载中...</div> : null}

          {!loading && !resources.length ? (
            <div className="favorites-empty">
              <div className="favorites-empty-icon" aria-hidden>
                <svg viewBox="0 0 80 80" fill="none">
                  <rect x="16" y="20" width="48" height="40" rx="10" fill="#FFFFFF" stroke="#1B2A4A" strokeWidth="2" />
                  <path d="M26 34h24M26 42h18" stroke="#D0D8E6" strokeWidth="3" strokeLinecap="round" />
                  <path d="M40 16l3.2 4.8 5.6.2-3.6 4.3 1.2 5.5L40 28l-6.4 2.8 1.2-5.5-3.6-4.3 5.6-.2L40 16z" fill="#2DB08A" />
                  <path d="M54 47c0-3.3 2.7-6 6-6s6 2.7 6 6-2.7 6-6 6-6-2.7-6-6z" fill="#FFF7CC" stroke="#1B2A4A" />
                  <path d="M60 44.8v4.4M57.8 47h4.4" stroke="#1B2A4A" strokeLinecap="round" />
                </svg>
              </div>
              <h3>还没有收藏任何资源</h3>
              <p>去资源广场挑选你喜欢的内容，点一下心形就会出现在这里。</p>
              <Link to="/categories" className="nav-cta favorites-empty-cta">去资源广场逛逛</Link>
            </div>
          ) : null}

          {!loading && resources.length > 0 && filteredResources.length === 0 ? (
            <div className="empty-box">
              当前筛选条件下没有匹配结果
              <button type="button" className="resource-btn" onClick={resetFilters} style={{ marginLeft: 10 }}>重置筛选</button>
            </div>
          ) : null}

          <div className="resource-grid">
            {filteredResources.map((item) => (
              <ResourceCard
                key={item.id}
                resource={item}
                isFavorite
                onToggleFavorite={removeFavorite}
                showFavorite={false}
                footerSlot={<button type="button" className="resource-btn delete" onClick={() => removeFavorite(item)}>取消收藏</button>}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
