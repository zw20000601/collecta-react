import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
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

const PRIORITY_COLUMNS_MISSING_REGEX = /column\s+messages\.(yesterday_vote_count|priority_date)\s+does\s+not\s+exist/i
const TITLE_COLUMN_MISSING_REGEX = /column\s+messages\.title\s+does\s+not\s+exist/i

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

function mergeRepliesByPost(pages) {
  return (pages || []).reduce((acc, page) => {
    const map = page && page.repliesByPost && typeof page.repliesByPost === 'object' ? page.repliesByPost : {}
    Object.keys(map).forEach((postId) => {
      const list = Array.isArray(map[postId]) ? map[postId] : []
      acc[postId] = list
    })
    return acc
  }, {})
}

async function fetchMessagesPage({ pageParam = 0, queryKey }) {
  const [, payload] = queryKey
  const activeTab = payload && payload.tab ? payload.tab : 'all'
  const sortBy = payload && payload.sort ? payload.sort : 'latest'
  const keyword = payload && payload.keyword ? payload.keyword : ''
  const userId = payload && payload.userId ? payload.userId : ''

  const from = pageParam * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  function buildQuery(enableDailyPriority) {
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
    } else if (enableDailyPriority) {
      query = query.order('yesterday_vote_count', { ascending: false }).order('created_at', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    if (keyword.trim()) {
      const safe = keyword.trim().replaceAll(',', ' ').replaceAll('%', ' ')
      query = query.or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
    }

    return query.range(from, to)
  }

  let usedPriorityFallback = false
  let { data: rows, error } = await buildQuery(true)

  if (error && PRIORITY_COLUMNS_MISSING_REGEX.test(String(error.message || ''))) {
    usedPriorityFallback = true
    const fallback = await buildQuery(false)
    rows = fallback.data
    error = fallback.error
  }

  if (error) {
    if (TITLE_COLUMN_MISSING_REGEX.test(String(error.message || ''))) {
      return {
        posts: [],
        repliesByPost: {},
        votedIds: [],
        hasMore: false,
        schemaUnsupported: true,
        priorityFallback: false,
      }
    }
    throw new Error(error.message || '读取留言失败')
  }

  const dataRows = rows || []
  const postIds = dataRows.map((row) => row.id)

  let voteMap = {}
  let replyMap = {}
  let votedIds = []

  if (postIds.length) {
    const [votesRes, repliesRes, userVotesRes] = await Promise.all([
      supabase.from('message_votes').select('post_id').in('post_id', postIds),
      supabase
        .from('message_replies')
        .select('id,post_id,user_id,content,is_official,created_at')
        .in('post_id', postIds)
        .order('created_at', { ascending: true }),
      userId
        ? supabase.from('message_votes').select('post_id').eq('user_id', userId).in('post_id', postIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (votesRes.error) {
      throw new Error(votesRes.error.message || '投票数据读取失败')
    }
    if (repliesRes.error) {
      throw new Error(repliesRes.error.message || '回复数据读取失败')
    }

    voteMap = (votesRes.data || []).reduce((acc, item) => {
      const key = item.post_id
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    replyMap = (repliesRes.data || []).reduce((acc, item) => {
      if (!acc[item.post_id]) acc[item.post_id] = []
      acc[item.post_id].push(item)
      return acc
    }, {})

    if (!userVotesRes.error) {
      votedIds = (userVotesRes.data || []).map((item) => item.post_id)
    }
  }

  const mappedPosts = dataRows.map((row) => {
    const hasRealtimeVoteCount = Object.prototype.hasOwnProperty.call(voteMap, row.id)
    const hasRealtimeReplyCount = Object.prototype.hasOwnProperty.call(replyMap, row.id)
    const voteCount = hasRealtimeVoteCount
      ? voteMap[row.id]
      : (typeof row.vote_count === 'number' ? row.vote_count : 0)
    const replyCount = hasRealtimeReplyCount
      ? (replyMap[row.id] || []).length
      : (typeof row.reply_count === 'number' ? row.reply_count : 0)

    return {
      id: row.id,
      user_id: row.user_id,
      title: String(row.title || row.content || '未命名留言').trim().slice(0, 80),
      content: String(row.content || '').trim(),
      category: normalizeCategory(row.category),
      status: normalizeStatus(row),
      vote_count: Math.max(0, voteCount),
      reply_count: Math.max(0, replyCount),
      created_at: row.created_at,
    }
  })

  return {
    posts: mappedPosts,
    repliesByPost: replyMap,
    votedIds,
    hasMore: dataRows.length === PAGE_SIZE,
    schemaUnsupported: false,
    priorityFallback: usedPriorityFallback,
  }
}

export default function Messages({ user }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = parseTab(searchParams.get('category'))
  const sortBy = parseSort(searchParams.get('sort'))
  const keyword = String(searchParams.get('keyword') || '')

  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formCategory, setFormCategory] = useState('resource')
  const [formStatus, setFormStatus] = useState('')
  const [submittingPost, setSubmittingPost] = useState(false)

  const [expandedSet, setExpandedSet] = useState(new Set())
  const [replyDrafts, setReplyDrafts] = useState({})
  const [replySubmittingPostId, setReplySubmittingPostId] = useState('')

  const sentinelRef = useRef(null)
  const priorityFallbackNotifiedRef = useRef(false)

  const messageQueryKey = useMemo(
    () => [
      'messages_feed',
      {
        tab: activeTab,
        sort: sortBy,
        keyword: keyword.trim(),
        userId: user ? user.id : '',
      },
    ],
    [activeTab, sortBy, keyword, user],
  )

  const messagesQuery = useInfiniteQuery({
    queryKey: messageQueryKey,
    queryFn: fetchMessagesPage,
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage && lastPage.hasMore ? pages.length : undefined),
    placeholderData: (prev) => prev,
  })

  const pages = messagesQuery.data && Array.isArray(messagesQuery.data.pages) ? messagesQuery.data.pages : []

  const schemaUnsupported = useMemo(
    () => pages.some((page) => page && page.schemaUnsupported),
    [pages],
  )

  const posts = useMemo(
    () => pages.flatMap((page) => (page && Array.isArray(page.posts) ? page.posts : [])),
    [pages],
  )

  const repliesByPost = useMemo(() => mergeRepliesByPost(pages), [pages])

  const votedSet = useMemo(() => {
    const set = new Set()
    pages.forEach((page) => {
      const list = page && Array.isArray(page.votedIds) ? page.votedIds : []
      list.forEach((id) => set.add(id))
    })
    return set
  }, [pages])

  const postsWithOfficialReply = useMemo(() => {
    return posts.map((post) => {
      const replies = repliesByPost[post.id] || []
      const officialReply = replies.find((item) => item.is_official)
      return { ...post, replies, officialReply }
    })
  }, [posts, repliesByPost])

  const loading = messagesQuery.isLoading
  const loadingMore = messagesQuery.isFetchingNextPage
  const hasMore = Boolean(messagesQuery.hasNextPage)

  useEffect(() => {
    if (!messagesQuery.error) return
    notifyError(`读取留言失败：${messagesQuery.error.message}`)
  }, [messagesQuery.error])

  useEffect(() => {
    if (!pages.length) return
    const hasPriorityFallback = pages.some((page) => page && page.priorityFallback)
    if (!hasPriorityFallback || priorityFallbackNotifiedRef.current) return
    notifyInfo('当前数据库尚未启用“昨日高票优先”，已自动按最新发布显示。')
    priorityFallbackNotifiedRef.current = true
  }, [pages])

  useEffect(() => {
    const channel = supabase
      .channel('messages-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['messages_feed'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_replies' }, () => {
        queryClient.invalidateQueries({ queryKey: ['messages_feed'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_votes' }, () => {
        queryClient.invalidateQueries({ queryKey: ['messages_feed'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  useEffect(() => {
    if (!hasMore || loading || loadingMore) return
    const node = sentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0] && entries[0].isIntersecting) {
          messagesQuery.fetchNextPage()
        }
      },
      { rootMargin: '280px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, messagesQuery])

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

  function patchMessageCache(patchFn) {
    queryClient.setQueryData(messageQueryKey, (old) => {
      if (!old || !Array.isArray(old.pages)) return old
      const nextPages = old.pages.map((page) => patchFn(page))
      return { ...old, pages: nextPages }
    })
  }

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
      queryClient.setQueryData(messageQueryKey, (old) => {
        if (!old || !Array.isArray(old.pages) || !old.pages.length) {
          return {
            pages: [{ posts: [created], repliesByPost: {}, votedIds: [], hasMore: false, schemaUnsupported: false, priorityFallback: false }],
            pageParams: [0],
          }
        }

        const first = old.pages[0]
        const firstPosts = Array.isArray(first.posts) ? first.posts : []
        if (firstPosts.some((item) => item.id === created.id)) return old

        const nextFirst = {
          ...first,
          posts: [created, ...firstPosts],
        }

        return {
          ...old,
          pages: [nextFirst, ...old.pages.slice(1)],
        }
      })
    }

    queryClient.invalidateQueries({ queryKey: ['messages_feed'] })
  }

  async function toggleVote(post) {
    if (!user) {
      notifyInfo('登录后可参与投票')
      navigate('/login?redirect=%2Fmessages')
      return
    }

    const alreadyVoted = votedSet.has(post.id)

    patchMessageCache((page) => {
      const postsInPage = page && Array.isArray(page.posts) ? page.posts : []
      if (!postsInPage.some((item) => item.id === post.id)) return page

      const votedIds = Array.isArray(page.votedIds) ? [...page.votedIds] : []
      const votedSetInner = new Set(votedIds)
      if (alreadyVoted) votedSetInner.delete(post.id)
      else votedSetInner.add(post.id)

      return {
        ...page,
        posts: postsInPage.map((item) => {
          if (item.id !== post.id) return item
          return { ...item, vote_count: Math.max(0, item.vote_count + (alreadyVoted ? -1 : 1)) }
        }),
        votedIds: Array.from(votedSetInner),
      }
    })

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

    notifyError(`投票失败：${opError.message}`)
    queryClient.invalidateQueries({ queryKey: messageQueryKey })
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

    patchMessageCache((page) => {
      const postsInPage = page && Array.isArray(page.posts) ? page.posts : []
      if (!postsInPage.some((item) => item.id === post.id)) return page

      const currentRepliesMap = page.repliesByPost && typeof page.repliesByPost === 'object' ? page.repliesByPost : {}
      const currentList = Array.isArray(currentRepliesMap[post.id]) ? currentRepliesMap[post.id] : []

      return {
        ...page,
        posts: postsInPage.map((item) => {
          if (item.id !== post.id) return item
          return { ...item, reply_count: item.reply_count + 1 }
        }),
        repliesByPost: {
          ...currentRepliesMap,
          [post.id]: [...currentList, data],
        },
      }
    })

    setReplyDrafts((prev) => ({ ...prev, [post.id]: '' }))
    setExpandedSet((prev) => {
      const next = new Set(prev)
      next.add(post.id)
      return next
    })

    notifySuccess('回复已发布')
  }

  const postsStatus = schemaUnsupported
    ? '数据库 messages 表缺少留言板新字段（title/category/status/vote_count/reply_count）。请先执行 supabase.sql 里的迁移 SQL。'
    : messagesQuery.error
    ? `读取留言失败：${messagesQuery.error.message}`
    : messagesQuery.isFetching && !loading
    ? '正在同步最新留言...'
    : ''

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

                  <div className="mb-vote-col">
                    <button
                      type="button"
                      className={`mb-vote-btn ${isVoted ? 'active' : ''}`}
                      onClick={() => toggleVote(post)}
                      aria-label={isVoted ? '取消投票' : '投票'}
                    >
                      <svg className="mb-vote-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 10v10H3V10h4z" />
                        <path d="M7 20h9.2a2.1 2.1 0 0 0 2-1.5l1.3-5a2.1 2.1 0 0 0-2-2.6H14V6.8c0-1.1-.9-2-2-2h-.2l-3.2 5.1c-.4.6-.6 1.2-.6 1.9V20z" />
                      </svg>
                      <span>{isVoted ? '已投票' : '投票'}</span>
                    </button>
                    <strong>{post.vote_count}</strong>
                    <small className="mb-vote-unit">票</small>
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

