import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import HeroClouds from '../components/HeroClouds'

const FEATURE_ITEMS = [
  {
    key: 'sync',
    title: '实时同步',
    desc: '多端数据即时同步，随时随地访问收藏库',
    iconClass: 'is-green',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M6 8.5A5.5 5.5 0 0 1 16.2 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18 6v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 15.5A5.5 5.5 0 0 1 7.8 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 18v-4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'smart',
    title: '智能分类',
    desc: 'AI 自动识别内容标签，精准归类无需手动整理',
    iconClass: 'is-purple',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 4.8 7 7.6v8.8l5 2.8 5-2.8V7.6l-5-2.8Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 11.2v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7.3 7.8 12 10.6l4.7-2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'search',
    title: '快速检索',
    desc: '按标题、标签、分类秒级搜索，海量收藏也能定位',
    iconClass: 'is-amber',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="6.8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M16 16 20.2 20.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'manage',
    title: '收藏管理',
    desc: '一键收藏、批量整理、分享给好友',
    iconClass: 'is-pink',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M6.2 6.4h11.6A1.8 1.8 0 0 1 19.6 8v10.2l-3.1-2.2-3.5 2.2-3.5-2.2-3.1 2.2V8a1.8 1.8 0 0 1 1.8-1.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 10.2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
]

export default function Home({ user, isGuest }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [stats, setStats] = useState({ resources: 0, users: 0, messages: 0 })
  const [statsReady, setStatsReady] = useState(false)

  const loadStats = useCallback(async () => {
    let resourcesRes = await supabase.from('resources').select('*', { count: 'exact', head: true }).eq('is_public', true)
    if (resourcesRes.error && /column .*is_public/i.test(String(resourcesRes.error.message || ''))) {
      resourcesRes = await supabase.from('resources').select('*', { count: 'exact', head: true }).eq('public', true)
    }

    const [usersRes, messagesRes] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('messages').select('*', { count: 'exact', head: true }),
    ])

    setStats({
      resources: typeof resourcesRes.count === 'number' ? resourcesRes.count : 0,
      users: typeof usersRes.count === 'number' ? usersRes.count : 0,
      messages: typeof messagesRes.count === 'number' ? messagesRes.count : 0,
    })
    setStatsReady(true)
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    const channel = supabase
      .channel('home-stats-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, loadStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, loadStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadStats)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadStats])

  function onSearch(event) {
    event.preventDefault()
    const keyword = query.trim()
    const qs = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
    navigate(`/categories/all${qs}`)
  }

  return (
    <main className="page page-home">
      <section className="hero hero-home">
        <HeroClouds />

        <div className="hero-inner split">
          <div className="hero-text">
            <h1>
              {'发现优质资源，'}
              <br />
              <span className="highlight">{'一键收藏到你的库'}</span>
            </h1>
            <p>
              {'这里展示所有公开资源。你可以实时搜索、按分类筛选，'}
              {user
                ? '也可以直接收藏并提交需求留言。'
                : isGuest
                ? '当前为游客模式，登录后可开启收藏和更多功能。'
                : '登录后还能收藏并提交需求。'}
            </p>

            <form className="search-bar" onSubmit={onSearch}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={'搜索标题、标签、分类...'}
              />
              <button className="search-btn" type="submit" aria-label="search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </form>
          </div>

          <div className="hero-illustration">
            <div className="mascot-container hero-visual">
              <svg className="mascot-svg" viewBox="0 0 420 420" fill="none">
                <circle cx="210" cy="210" r="140" fill="#E8F4FD" />
                <circle cx="210" cy="210" r="118" fill="#FFFFFF" stroke="#E8EAF0" strokeWidth="3" />
                <rect x="140" y="130" width="140" height="176" rx="22" fill="#FFFFFF" stroke="#1B2A4A" strokeWidth="3" />
                <rect x="160" y="162" width="96" height="12" rx="6" fill="#E8EAF0" />
                <rect x="160" y="188" width="82" height="10" rx="5" fill="#E8EAF0" />
                <rect x="160" y="210" width="70" height="10" rx="5" fill="#E8EAF0" />
                <rect x="160" y="246" width="58" height="34" rx="10" fill="#FFE033" stroke="#1B2A4A" strokeWidth="2" />
                <path d="M230 95l16 18 24-2-13 20 7 23-23-8-19 13-1-25-20-14 24-7 5-24z" fill="#2DB08A" opacity=".9" />
                <circle cx="122" cy="178" r="22" fill="#E1F5EE" stroke="#2DB08A" strokeWidth="2" />
                <path d="M113 178h18M122 169v18" stroke="#1B2A4A" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="303" cy="248" r="18" fill="#FFF8DC" stroke="#1B2A4A" strokeWidth="2" />
                <path d="M295 248h16" stroke="#1B2A4A" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              <span className="float-chip chip-a">{'实时同步'}</span>
              <span className="float-chip chip-b">{'智能分类'}</span>
              <span className="float-chip chip-c">{'快速检索'}</span>
              <span className="float-chip chip-d">{'收藏管理'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="container">
          <div className="home-feature-grid">
            {FEATURE_ITEMS.map((item) => (
              <article key={item.key} className="home-feature-card">
                <span className={`home-feature-icon ${item.iconClass}`} aria-hidden="true">{item.icon}</span>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="container">
          <div className="home-stats-strip">
            <div className="home-stats-item">
              <span className="home-stats-label">精选资源</span>
              <strong>{statsReady ? stats.resources : '--'}</strong>
              <p>公开资源总数</p>
            </div>
            <div className="home-stats-item">
              <span className="home-stats-label">活跃用户</span>
              <strong>{statsReady ? stats.users : '--'}</strong>
              <p>注册用户总数</p>
            </div>
            <div className="home-stats-item">
              <span className="home-stats-label">社区互动</span>
              <strong>{statsReady ? stats.messages : '--'}</strong>
              <p>留言总数</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section-block home-action-section">
        <div className="container">
          <div className="home-action-strip">
            <div>
              <h3>还没找到想要的资源？</h3>
              <p>在留言板提交需求，社区会帮你找到</p>
            </div>
            <button type="button" className="home-action-btn" onClick={() => navigate('/messages')}>去留言板</button>
          </div>
        </div>
      </section>
    </main>
  )
}
