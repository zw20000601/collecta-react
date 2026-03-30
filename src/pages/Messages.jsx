import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { notifyError, notifyInfo, notifySuccess } from '../lib/notify'
import HeroClouds from '../components/HeroClouds'

const PAGE_SIZE = 8

const CATEGORY_META = {
  resource: { label: '资源需求', className: 'is-resource' },
  feature: { label: '功能建议', className: 'is-feature' },
  bug: { label: '问题反馈', className: 'is-bug' },
  other: { label: '其他', className: 'is-other' },
}

const STATUS_META = {
  pending: { label: '待处理', className: 'is-pending' },
  in_progress: { label: '开发中', className: 'is-progress' },
  done: { label: '已完成', className: 'is-done' },
}

const SORT_OPTIONS = [
  { value: 'latest', label: '最新发布' },
  { value: 'votes', label: '最多投票' },
  { value: 'pending', label: '待处理' },
]

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'resource', label: '资源需求' },
  { key: 'feature', label: '功能建议' },
  { key: 'bug', label: '问题反馈' },
]

function normalizeCategory(value) {
  if (value && CATEGORY_META[value]) return value
  return 'other'
}

function normalizeStatus(row) {
  if (row && row.status && STATUS_META[row.status]) return row.status
  if (row && row.is_done === true) return 'done'
  return 'pending'
}

function parseTab(value) {
  if (value === 'resource' || value === 'feature' || value === 'bug') return value
  return 'all'
}

function parseSort(value) {
  if (value === 'votes' || value === 'pending') return value
  return 'latest'
}

function formatTime(value) {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '-'
  return new Date(time).toLocaleString()
}

function displayNameOf(post, currentUser) {
  if (currentUser && post.user_id === currentUser.id) return '我'
  const id = String(post.user_id || '')
  if (!id) return '游客'
  return `用户${id.slice(0, 4)}`
}

function shouldShowPost(post, tab, keyword) {
  if (tab !== 'all' && post.category !== tab) return false
  if (!keyword) return true
  const text = [post.title, post.content, post.category, post.status].join(' ').toLowerCase()
  return text.includes(keyword.toLowerCase())
}

export default function Messages({ user }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = parseTab(searchParams.get('category'))
  const sortBy = parseSort(searchParams.get('sort'))
  const keyword = String(searchParams.get('keyword') || '')

  const [posts, setPosts] = useState([])
  const [postsStatus, setPostsStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formCategory, setFormCategory] = useState('resource')
  const [formStatus, setFormStatus] = useState('')
  const [submittingPost, setSubmittingPost] = useState(false)

  const [votedSet, setVotedSet] = useState(new Set())
  const [repliesByPost, setRepliesByPost] = useState({})
  const [expandedSet, setExpandedSet] = useState(new Set())
  const [replyDrafts, setReplyDrafts] = useState({})
  const [replySubmittingPostId, setReplySubmittingPostId] = useState('')

  const pageRef = useRef(0)
  const loadingRef = useRef(false)
  const sentinelRef = useRef(null)
  const schemaErrorNotifiedRef = useRef(false)
  const schemaUnsupportedRef = useRef(false)

  function updateQuery(next) {
    const params = new URLSearchParams(searchParams)

    if (next.category !== undefined) {
      if (!next.category || next.category === 'all') params.delete('category')
      else params.set('category', next.category)
    }

    if (next.sort !== undefined) {
      if (!next.sort || next.sort === 'latest') params.delete('sort')
      else params.set('sort', next.sort)
    }

    if (next.keyword !== undefined) {
      const value = String(next.keyword || '').trim()
      if (!value) params.delete('keyword')
      else params.set('keyword', value)
    }

    setSearchParams(params, { replace: true })
  }

  const loadPosts = useCallback(async (reset) => {
    if (schemaUnsupportedRef.current) return
    if (loadingRef.current) return
    loadingRef.current = true

    if (reset) {
      pageRef.current = 0
      setHasMore(true)
      setLoading(true)
      setPostsStatus('')
    } else {
      setLoadingMore(true)
    }

    const from = pageRef.current * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('messages')
      .select('id,user_id,title,content,category,status,is_done,created_at,vote_count,reply_count')

    if (activeTab !== 'all') {
      query = query.eq('category', activeTab)
    }

    if (sortBy === 'votes') {
      query = query.order('vote_count', { ascending: false }).order('created_at', { ascending: false })
    } else if (sortBy === 'pending') {
      query = query.eq('status', 'pending').order('created_at', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    if (keyword.trim()) {
      const safe = keyword.trim().replaceAll(',', ' ').replaceAll('%', ' ')
      query = query.or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
    }

    query = query.range(from, to)

    const { data, error } = await query

    if (error) {
      const rawMessage = String(error.message || '')
      const isMissingTitleColumn = /column\s+messages\.title\s+does\s+not\s+exist/i.test(rawMessage)

      if (isMissingTitleColumn) {
        schemaUnsupportedRef.current = true
        setHasMore(false)
        setPostsStatus('数据库 messages 表缺少留言板新字段（title/category/status/vote_count/reply_count）。请先执行 supabase.sql 里的迁移 SQL。')
        if (!schemaErrorNotifiedRef.current) {
          notifyError('留言板数据库未升级：messages.title 不存在，请先执行迁移 SQL')
          schemaErrorNotifiedRef.current = true
        }
      } else {
        const msg = `读取留言失败：${rawMessage}`
        setPostsStatus(msg)
        notifyError(msg)
        setHasMore(false)
      }

      if (reset) setPosts([])
      setLoading(false)
      setLoadingMore(false)
      loadingRef.current = false
      return
    }

    const rows = data || []
    const postIds = rows.map((row) => row.id)

    let voteMap = {}
    let replyMap = {}
    let userVotes = []

    if (postIds.length) {
      const [votesRes, repliesRes, userVoteRes] = await Promise.all([
        supabase.from('message_votes').select('post_id').in('post_id', postIds),
        supabase
          .from('message_replies')
          .select('id,post_id,user_id,content,is_official,created_at')
          .in('post_id', postIds)
          .order('created_at', { ascending: true }),
        user
          ? supabase.from('message_votes').select('post_id').eq('user_id', user.id).in('post_id', postIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (votesRes.error) {
        notifyError(`投票数据读取失败：${votesRes.error.message}`)
      } else {
        voteMap = (votesRes.data || []).reduce((acc, item) => {
          const key = item.post_id
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {})
      }

      if (repliesRes.error) {
        notifyError(`回复数据读取失败：${repliesRes.error.message}`)
      } else {
        replyMap = (repliesRes.data || []).reduce((acc, item) => {
          if (!acc[item.post_id]) acc[item.post_id] = []
          acc[item.post_id].push(item)
          return acc
        }, {})
      }

      if (userVoteRes && !userVoteRes.error) {
        userVotes = (userVoteRes.data || []).map((item) => item.post_id)
      }
    }

    const mapped = rows.map((row) => {
      const category = normalizeCategory(row.category)
      const status = normalizeStatus(row)
      const voteCount = typeof row.vote_count === 'number' ? row.vote_count : (voteMap[row.id] || 0)
      const replyCount = typeof row.reply_count === 'number' ? row.reply_count : ((replyMap[row.id] || []).length)

      return {
        id: row.id,
        user_id: row.user_id,
        title: String(row.title || row.content || '未命名留言').trim().slice(0, 80),
        content: String(row.content || '').trim(),
        category,
        status,
        vote_count: Math.max(0, voteCount),
        reply_count: Math.max(0, replyCount),
        created_at: row.created_at,
      }
    })

    setRepliesByPost((prev) => ({ ...prev, ...replyMap }))
    if (userVotes.length) {
      setVotedSet((prev) => {
        const next = new Set(prev)
        userVotes.forEach((id) => next.add(id))
        return next
      })
    }

    setPosts((prev) => {
      if (reset) return mapped
      const exists = new Set(prev.map((item) => item.id))
      const append = mapped.filter((item) => !exists.has(item.id))
      return [...prev, ...append]
    })

    if (rows.length < PAGE_SIZE) {
      setHasMore(false)
    } else {
      pageRef.current += 1
      setHasMore(true)
    }

    setLoading(false)
    setLoadingMore(false)
    loadingRef.current = false
  }, [activeTab, sortBy, keyword, user])

  useEffect(() => {
    loadPosts(true)
  }, [loadPosts])

  useEffect(() => {
    const channel = supabase
      .channel('messages-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => loadPosts(true),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_replies' },
        () => loadPosts(true),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_votes' },
        () => loadPosts(true),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadPosts])

  useEffect(() => {
    if (!hasMore || loading || loadingMore) return
    const node = sentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0] && entries[0].isIntersecting) {
          loadPosts(false)
        }
      },
      { rootMargin: '280px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, loadPosts])

  function toggleExpand(postId) {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  async function submitPost(event) {
    event.preventDefault()

    if (!user) {
      notifyInfo('登录后可发布留言')
      navigate('/login?redirect=%2Fmessages')
      return
    }

    const title = formTitle.trim()
    const content = formContent.trim()

    if (!title && !content) {
      setFormStatus('请至少填写“简短描述”或“详细说明”其中一项')
      return
    }

    const finalTitle = title || content.slice(0, 80)
    const finalContent = content || title

    setSubmittingPost(true)
    setFormStatus('')

    const payload = {
      user_id: user.id,
      title: finalTitle,
      content: finalContent,
      category: formCategory,
      status: 'pending',
    }

    const { data, error } = await supabase
      .from('messages')
      .insert(payload)
      .select('id,user_id,title,content,category,status,is_done,created_at,vote_count,reply_count')
      .single()

    setSubmittingPost(false)

    if (error) {
      const msg = `发布失败：${error.message}`
      setFormStatus(msg)
      notifyError(msg)
      return
    }

    const created = {
      id: data.id,
      user_id: data.user_id,
      title: String(data.title || finalTitle),
      content: String(data.content || finalContent),
      category: normalizeCategory(data.category),
      status: normalizeStatus(data),
      vote_count: typeof data.vote_count === 'number' ? data.vote_count : 0,
      reply_count: typeof data.reply_count === 'number' ? data.reply_count : 0,
      created_at: data.created_at,
    }

    setFormTitle('')
    setFormContent('')
    setFormCategory('resource')
    setFormStatus('发布成功')
    notifySuccess('留言已发布')

    if (shouldShowPost(created, activeTab, keyword)) {
      setPosts((prev) => [created, ...prev])
    }
  }

  async function toggleVote(post) {
    if (!user) {
      notifyInfo('登录后可参与投票')
      navigate('/login?redirect=%2Fmessages')
      return
    }

    const alreadyVoted = votedSet.has(post.id)

    setVotedSet((prev) => {
      const next = new Set(prev)
      if (alreadyVoted) next.delete(post.id)
      else next.add(post.id)
      return next
    })

    setPosts((prev) => prev.map((item) => {
      if (item.id !== post.id) return item
      const nextVotes = Math.max(0, item.vote_count + (alreadyVoted ? -1 : 1))
      return { ...item, vote_count: nextVotes }
    }))

    let opError = null

    if (alreadyVoted) {
      const { error } = await supabase
        .from('message_votes')
        .delete()
        .eq('post_id', post.id)
        .eq('user_id', user.id)
      opError = error
    } else {
      const { error } = await supabase
        .from('message_votes')
        .insert({ post_id: post.id, user_id: user.id })
      if (error && error.code !== '23505') {
        opError = error
      }
    }

    if (!opError) return

    setVotedSet((prev) => {
      const next = new Set(prev)
      if (alreadyVoted) next.add(post.id)
      else next.delete(post.id)
      return next
    })

    setPosts((prev) => prev.map((item) => {
      if (item.id !== post.id) return item
      const rollbackVotes = Math.max(0, item.vote_count + (alreadyVoted ? 1 : -1))
      return { ...item, vote_count: rollbackVotes }
    }))

    notifyError(`投票失败：${opError.message}`)
  }

  async function submitReply(post) {
    if (!user) {
      notifyInfo('登录后可回复留言')
      navigate('/login?redirect=%2Fmessages')
      return
    }

    const text = String(replyDrafts[post.id] || '').trim()
    if (!text) {
      notifyInfo('请输入回复内容')
      return
    }

    setReplySubmittingPostId(post.id)

    const { data, error } = await supabase
      .from('message_replies')
      .insert({
        post_id: post.id,
        user_id: user.id,
        content: text,
        is_official: false,
      })
      .select('id,post_id,user_id,content,is_official,created_at')
      .single()

    setReplySubmittingPostId('')

    if (error) {
      notifyError(`回复失败：${error.message}`)
      return
    }

    setRepliesByPost((prev) => {
      const list = prev[post.id] || []
      return { ...prev, [post.id]: [...list, data] }
    })

    setPosts((prev) => prev.map((item) => {
      if (item.id !== post.id) return item
      return { ...item, reply_count: item.reply_count + 1 }
    }))

    setReplyDrafts((prev) => ({ ...prev, [post.id]: '' }))
    setExpandedSet((prev) => {
      const next = new Set(prev)
      next.add(post.id)
      return next
    })

    notifySuccess('回复已发布')
  }

  const postsWithOfficialReply = useMemo(() => {
    return posts.map((post) => {
      const replies = repliesByPost[post.id] || []
      const officialReply = replies.find((item) => item.is_official)
      return { ...post, replies, officialReply }
    })
  }, [posts, repliesByPost])

  return (
    <main className="page messages-v2-page">
      <section className="section-block hero-lite messages-v2-hero">
        <HeroClouds />
        <div className="container">
          <span className="mb-community-badge">社区驱动</span>
          <h1 className="page-title">留言板</h1>
          <p className="page-subtitle">有想要的资源？提需求、投票、看进展。你的每一条留言都在让 Collecta 变得更好。</p>
        </div>
      </section>

      <section className="section-block messages-v2-main">
        <div className="container">
          {user ? (
            <form className="mb-post-form" onSubmit={submitPost}>
              <div className="mb-avatar">我</div>
              <div className="mb-post-inputs">
                <input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  maxLength={80}
                  placeholder="简短描述你的需求..."
                />
                <textarea
                  rows={3}
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  maxLength={600}
                  placeholder="详细说明：你想找什么类型的资源？有什么具体场景？越详细越容易被采纳～"
                />
                <div className="mb-post-actions">
                  <div className="mb-category-pills">
                    {Object.entries(CATEGORY_META).map(([key, meta]) => (
                      <button
                        key={key}
                        type="button"
                        className={`mb-pill ${meta.className} ${formCategory === key ? 'active' : ''}`}
                        onClick={() => setFormCategory(key)}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                  <button className="nav-cta" type="submit" disabled={submittingPost}>
                    {submittingPost ? '发布中...' : '发布留言'}
                  </button>
                </div>
                {formStatus ? <p className="mini-status">{formStatus}</p> : null}
              </div>
            </form>
          ) : (
            <div className="mb-login-tip">
              登录后可以发布资源需求、参与投票并回复讨论。
              <button className="resource-btn" type="button" onClick={() => navigate('/login?redirect=%2Fmessages')}>去登录</button>
            </div>
          )}

          <div className="mb-filter-bar">
            <div className="mb-tabs">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`mb-tab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => updateQuery({ category: tab.key })}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mb-filter-right">
              <label className="mb-search" aria-label="搜索留言">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  value={keyword}
                  onChange={(e) => updateQuery({ keyword: e.target.value })}
                  placeholder="搜索留言..."
                />
              </label>

              <select value={sortBy} onChange={(e) => updateQuery({ sort: e.target.value })}>
                {SORT_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-list-wrap">
            {loading ? <div className="empty-box">留言加载中...</div> : null}
            {!loading && !postsWithOfficialReply.length ? <div className="empty-box">暂无符合筛选条件的留言</div> : null}

            {postsWithOfficialReply.map((post) => {
              const categoryMeta = CATEGORY_META[post.category] || CATEGORY_META.other
              const statusMeta = STATUS_META[post.status] || STATUS_META.pending
              const isExpanded = expandedSet.has(post.id)
              const isVoted = votedSet.has(post.id)

              return (
                <article className="mb-post-card" key={post.id}>
                  <div className="mb-vote-col">
                    <button
                      type="button"
                      className={`mb-vote-btn ${isVoted ? 'active' : ''}`}
                      onClick={() => toggleVote(post)}
                      aria-label="投票"
                    >
                      <svg className="mb-vote-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 14 12 8 18 14" />
                      </svg>
                    </button>
                    <strong>{post.vote_count}</strong>
                  </div>

                  <div className="mb-post-main">
                    <div className="mb-post-head">
                      <h3>{post.title}</h3>
                      <div className="mb-post-badges">
                        <span className={`mb-category-tag ${categoryMeta.className}`}>{categoryMeta.label}</span>
                        <span className={`mb-status-tag ${statusMeta.className}`}>{statusMeta.label}</span>
                      </div>
                    </div>

                    <p className={`mb-post-content ${isExpanded ? 'expanded' : ''}`}>{post.content}</p>
                    {post.content.length > 120 ? (
                      <button type="button" className="mb-expand-btn" onClick={() => toggleExpand(post.id)}>
                        {isExpanded ? '收起' : '展开查看'}
                      </button>
                    ) : null}

                    <div className="mb-post-meta">
                      <span className="mb-meta-item">
                        <svg className="mb-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="8" r="3.2" />
                          <path d="M5 19.2c1.7-3 4-4.5 7-4.5s5.3 1.5 7 4.5" />
                        </svg>
                        {displayNameOf(post, user)}
                      </span>
                      <span className="mb-meta-item">
                        <svg className="mb-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="8" />
                          <path d="M12 7.8v4.8l3 1.7" />
                        </svg>
                        {formatTime(post.created_at)}
                      </span>
                      <span className="mb-meta-item">
                        <svg className="mb-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="6" width="16" height="13" rx="2" />
                          <line x1="8" y1="4" x2="8" y2="8" />
                          <line x1="16" y1="4" x2="16" y2="8" />
                        </svg>
                        {post.reply_count} 条回复
                      </span>
                      <button type="button" className="mb-reply-open-btn" onClick={() => toggleExpand(post.id)}>回复</button>
                    </div>

                    {post.officialReply ? (
                      <div className="mb-official-reply">
                        <strong>官方回复</strong>
                        <p>{post.officialReply.content}</p>
                      </div>
                    ) : null}

                    {isExpanded ? (
                      <div className="mb-replies-panel">
                        {(post.replies || []).map((reply) => (
                          <div key={reply.id} className={`mb-reply-item ${reply.is_official ? 'official' : ''}`}>
                            <div className="mb-reply-head">
                              <span>{reply.is_official ? '官方' : displayNameOf({ user_id: reply.user_id }, user)}</span>
                              <span>{formatTime(reply.created_at)}</span>
                            </div>
                            <p>{reply.content}</p>
                          </div>
                        ))}

                        {user ? (
                          <div className="mb-reply-editor">
                            <textarea
                              rows={2}
                              value={replyDrafts[post.id] || ''}
                              onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                              placeholder="输入你的回复内容"
                            />
                            <div className="mb-reply-actions">
                              <button
                                type="button"
                                className="nav-cta"
                                disabled={replySubmittingPostId === post.id}
                                onClick={() => submitReply(post)}
                              >
                                {replySubmittingPostId === post.id ? '提交中...' : '提交回复'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}

            {postsStatus ? <p className="mini-status">{postsStatus}</p> : null}
            {loadingMore ? <p className="mini-status">正在加载更多...</p> : null}
            {!hasMore && !loading && postsWithOfficialReply.length ? <p className="mini-status">已经到底了</p> : null}
            <div ref={sentinelRef} style={{ height: 1 }} />
          </div>
        </div>
      </section>
    </main>
  )
}
