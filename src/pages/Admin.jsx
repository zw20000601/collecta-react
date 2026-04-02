import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { notifyError, notifyInfo, notifySuccess } from '../lib/notify'
import { createResourceSlug, normalizeResource, normalizeTags } from '../lib/resourceUtils'
import { getDefaultCategoryName } from '../lib/resourceCategories'
import CategoryIcon from '../components/CategoryIcon'

const ADMIN_MENU = [
  { key: 'overview', label: '概览', to: '/admin/overview' },
  { key: 'resources', label: '资源管理', to: '/admin/resources' },
  { key: 'messages', label: '留言管理', to: '/admin/messages' },
  { key: 'users', label: '用户管理', to: '/admin/users' },
  { key: 'logs', label: '操作日志', to: '/admin/logs' },
]

const TITLE_MAP = {
  overview: '概览',
  resources: '资源管理',
  messages: '留言管理',
  users: '用户管理',
  logs: '操作日志',
}

const EMPTY_RESOURCE_FORM = {
  title: '',
  url: '',
  category: '',
  cover_url: '',
  tags: '',
  note: '',
  is_public: true,
}

const MESSAGE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'in_progress', label: '开发中' },
  { value: 'done', label: '已完成' },
]

const MESSAGE_STATUS_OPTIONS = [
  { value: 'pending', label: '待处理' },
  { value: 'in_progress', label: '开发中' },
  { value: 'done', label: '已完成' },
]

const CATEGORY_LABEL = {
  resource: '资源需求',
  feature: '功能建议',
  bug: '问题反馈',
  other: '其他',
}

const MESSAGE_STATUS_COLOR_MAP = {
  pending: '#BA7517',
  in_progress: '#534AB7',
  done: '#1D9E75',
}

const CATEGORY_ICON_PRESETS = [
  { label: '游戏', icon: '🎮' },
  { label: '文章', icon: '📚' },
  { label: 'PPT', icon: '📊' },
  { label: '软件', icon: '💾' },
  { label: '工具', icon: '🛠️' },
  { label: '设计', icon: '🎨' },
  { label: '视频', icon: '🎬' },
  { label: '电子书', icon: '📖' },
  { label: '播客', icon: '🎧' },
  { label: '笔记', icon: '📝' },
  { label: '代码', icon: '💻' },
  { label: '模板', icon: '🧩' },
]

function activeSectionFromPath(pathname) {
  const key = String(pathname || '').split('/')[2] || 'overview'
  return TITLE_MAP[key] ? key : 'overview'
}

function fmtTime(value) {
  const n = new Date(value || '').getTime()
  if (Number.isNaN(n)) return '-'
  return new Date(n).toLocaleString()
}

function userAlias(userId) {
  const raw = String(userId || '').trim()
  if (!raw) return '匿名用户'
  return `User_` + raw.slice(0, 5)
}

function normalizeMessage(row) {
  const status = row && row.status ? row.status : (row && row.is_done ? 'done' : 'pending')
  return {
    id: row.id,
    user_id: row.user_id,
    title: String(row.title || row.content || '未命名留言').trim().slice(0, 80),
    content: String(row.content || '').trim(),
    category: CATEGORY_LABEL[row.category] ? row.category : 'other',
    status: status === 'in_progress' || status === 'done' ? status : 'pending',
    vote_count: typeof row.vote_count === 'number' ? row.vote_count : 0,
    reply_count: typeof row.reply_count === 'number' ? row.reply_count : 0,
    created_at: row.created_at,
  }
}

function mapRepliesByPost(rows) {
  return (rows || []).reduce((acc, item) => {
    if (!acc[item.post_id]) acc[item.post_id] = []
    acc[item.post_id].push(item)
    return acc
  }, {})
}

function mapUserRow(row) {
  const roleKey = Object.prototype.hasOwnProperty.call(row, 'role')
    ? 'role'
    : Object.prototype.hasOwnProperty.call(row, 'user_role')
    ? 'user_role'
    : ''
  const statusKey = Object.prototype.hasOwnProperty.call(row, 'status')
    ? 'status'
    : Object.prototype.hasOwnProperty.call(row, 'account_status')
    ? 'account_status'
    : Object.prototype.hasOwnProperty.call(row, 'disabled')
    ? 'disabled'
    : ''

  const roleVal = roleKey ? String(row[roleKey] || '').toLowerCase() : 'user'
  const role = roleVal === 'admin' ? 'admin' : 'user'

  let status = 'active'
  if (statusKey === 'disabled') status = row.disabled ? 'disabled' : 'active'
  if (statusKey === 'status' || statusKey === 'account_status') {
    const v = String(row[statusKey] || '').toLowerCase()
    status = v === 'disabled' || v === 'blocked' ? 'disabled' : 'active'
  }

  return {
    id: row.id,
    email: String(row.email || row.user_email || row.username || row.id || '-'),
    created_at: row.created_at || row.inserted_at || null,
    role,
    status,
    roleKey,
    statusKey,
  }
}

function statusLabel(status) {
  const hit = MESSAGE_STATUS_OPTIONS.find((item) => item.value === status)
  return hit ? hit.label : '待处理'
}

export default function Admin({ user, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const section = activeSectionFromPath(location.pathname)

  const [stats, setStats] = useState({ resources: 0, messages: 0, pending: 0, users: 0 })
  const [resources, setResources] = useState([])
  const [resourceCategories, setResourceCategories] = useState([])
  const [messages, setMessages] = useState([])
  const [repliesByPost, setRepliesByPost] = useState({})
  const [users, setUsers] = useState([])

  const [resourceForm, setResourceForm] = useState(EMPTY_RESOURCE_FORM)
  const [resourceFormOpen, setResourceFormOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [resourceKeyword, setResourceKeyword] = useState('')
  const [resourceCategory, setResourceCategory] = useState('全部')
  const [categoryEditingId, setCategoryEditingId] = useState('')
  const [categoryDraft, setCategoryDraft] = useState({ name: '', emoji: '', sort_order: '' })
  const categoryIconUploadRef = useRef(null)
  const resourceCoverUploadRef = useRef(null)

  const [messageFilter, setMessageFilter] = useState('all')
  const [messageKeyword, setMessageKeyword] = useState('')
  const [replyOpenMap, setReplyOpenMap] = useState({})
  const [officialReplyDrafts, setOfficialReplyDrafts] = useState({})

  const [userKeyword, setUserKeyword] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('all')
  const [busyKey, setBusyKey] = useState('')
  const [errorText, setErrorText] = useState('')
  const [actionLogs, setActionLogs] = useState([])
  const [logDateFrom, setLogDateFrom] = useState('')
  const [logDateTo, setLogDateTo] = useState('')

  useEffect(() => {
    if (location.pathname === '/admin' || location.pathname === '/admin/') {
      navigate('/admin/overview', { replace: true })
    }
  }, [location.pathname, navigate])

  function addLog(type, target) {
    setActionLogs((prev) => [
      { id: Date.now().toString() + '-' + Math.random().toString(16).slice(2), created_at: new Date().toISOString(), type, target },
      ...prev,
    ])
  }

  const statsQuery = useQuery({
    queryKey: ['admin_stats'],
    queryFn: async () => {
      const [r, m, p, u] = await Promise.all([
        supabase.from('resources').select('*', { count: 'exact', head: true }),
        supabase.from('messages').select('*', { count: 'exact', head: true }),
        supabase.from('messages').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
      ])

      return {
        resources: typeof r.count === 'number' ? r.count : 0,
        messages: typeof m.count === 'number' ? m.count : 0,
        pending: typeof p.count === 'number' ? p.count : 0,
        users: typeof u.count === 'number' ? u.count : 0,
      }
    },
  })

  const resourcesQuery = useQuery({
    queryKey: ['admin_resources'],
    queryFn: async () => {
      const result = await supabase.from('resources').select('*').order('created_at', { ascending: false })
      if (result.error) throw new Error(result.error.message || '读取资源失败')
      return (result.data || []).map(normalizeResource)
    },
  })

  const categoriesQuery = useQuery({
    queryKey: ['admin_resource_categories'],
    queryFn: async () => {
      const result = await supabase
        .from('resource_categories')
        .select('id,name,emoji,sort_order,is_active,created_at')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (result.error) throw new Error(result.error.message || '读取分类失败')

      return (result.data || [])
        .map((item) => ({
          id: item.id,
          name: String(item.name || '').trim(),
          emoji: String(item.emoji || '').trim() || '📁',
          sort_order: typeof item.sort_order === 'number' ? item.sort_order : 100,
        }))
        .filter((item) => item.name)
    },
  })

  const messagesQuery = useQuery({
    queryKey: ['admin_messages_bundle'],
    queryFn: async () => {
      const [m, r] = await Promise.all([
        supabase
          .from('messages')
          .select('id,user_id,title,content,category,status,is_done,created_at,vote_count,reply_count')
          .order('created_at', { ascending: false }),
        supabase
          .from('message_replies')
          .select('id,post_id,user_id,content,is_official,created_at')
          .order('created_at', { ascending: true }),
      ])

      if (m.error) throw new Error(m.error.message || '读取留言失败')
      if (r.error) throw new Error(r.error.message || '读取回复失败')

      return {
        messages: (m.data || []).map(normalizeMessage),
        repliesByPost: mapRepliesByPost(r.data || []),
      }
    },
  })

  const usersQuery = useQuery({
    queryKey: ['admin_users'],
    queryFn: async () => {
      let result = await supabase
        .from('profiles')
        .select('id,email,role,user_role,status,account_status,disabled,created_at,inserted_at')
        .order('created_at', { ascending: false })

      if (result.error && /column .* does not exist/i.test(String(result.error.message || ''))) {
        result = await supabase.from('profiles').select('*')
      }
      if (result.error) throw new Error(result.error.message || '读取用户失败')

      return (result.data || []).map(mapUserRow)
    },
  })

  useEffect(() => {
    if (statsQuery.data) setStats(statsQuery.data)
  }, [statsQuery.data])

  useEffect(() => {
    if (resourcesQuery.data) setResources(resourcesQuery.data)
  }, [resourcesQuery.data])

  useEffect(() => {
    if (!categoriesQuery.data) return
    setResourceCategories(categoriesQuery.data)
  }, [categoriesQuery.data])

  useEffect(() => {
    if (!messagesQuery.data) return
    setMessages(messagesQuery.data.messages)
    setRepliesByPost(messagesQuery.data.repliesByPost)
  }, [messagesQuery.data])

  useEffect(() => {
    if (usersQuery.data) setUsers(usersQuery.data)
  }, [usersQuery.data])

  useEffect(() => {
    const firstError =
      statsQuery.error ||
      resourcesQuery.error ||
      categoriesQuery.error ||
      messagesQuery.error ||
      usersQuery.error

    if (!firstError) {
      setErrorText('')
      return
    }

    setErrorText(firstError.message || '后台数据读取失败')
  }, [statsQuery.error, resourcesQuery.error, categoriesQuery.error, messagesQuery.error, usersQuery.error])

  async function refreshStats() {
    await queryClient.invalidateQueries({ queryKey: ['admin_stats'] })
  }

  async function refreshResources() {
    await queryClient.invalidateQueries({ queryKey: ['admin_resources'] })
  }

  async function refreshResourceCategories() {
    await queryClient.invalidateQueries({ queryKey: ['admin_resource_categories'] })
  }

  async function refreshMessages() {
    await queryClient.invalidateQueries({ queryKey: ['admin_messages_bundle'] })
  }

  async function refreshUsers() {
    await queryClient.invalidateQueries({ queryKey: ['admin_users'] })
  }

  async function refreshAll() {
    setErrorText('')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin_stats'] }),
      queryClient.invalidateQueries({ queryKey: ['admin_resources'] }),
      queryClient.invalidateQueries({ queryKey: ['admin_resource_categories'] }),
      queryClient.invalidateQueries({ queryKey: ['admin_messages_bundle'] }),
      queryClient.invalidateQueries({ queryKey: ['admin_users'] }),
    ])
  }
  function updateResourceForm(field, value) {
    setResourceForm((prev) => ({ ...prev, [field]: value }))
  }

  function resetResourceForm() {
    setEditingId('')
    setResourceForm({
      ...EMPTY_RESOURCE_FORM,
      category: getDefaultCategoryName(resourceCategories),
    })
  }

  function openCreateResourceForm() {
    resetResourceForm()
    setResourceFormOpen(true)
  }

  function closeResourceForm() {
    setResourceFormOpen(false)
    resetResourceForm()
  }

  function triggerResourceCoverUpload() {
    if (!resourceCoverUploadRef.current) return
    resourceCoverUploadRef.current.click()
  }

  function handleResourceCoverUpload(event) {
    const file = event.target && event.target.files && event.target.files[0] ? event.target.files[0] : null
    if (!file) return

    if (!/^image\//i.test(file.type || '')) {
      notifyInfo('请上传图片文件（PNG/JPG/SVG/WebP）')
      event.target.value = ''
      return
    }

    const maxSize = 2 * 1024 * 1024
    if (file.size > maxSize) {
      notifyInfo('封面图请控制在 2MB 以内')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) {
        notifyError('读取封面图失败，请重试')
        return
      }
      updateResourceForm('cover_url', dataUrl)
      notifySuccess('封面图已加载')
    }
    reader.onerror = () => notifyError('读取封面图失败，请重试')
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function buildResourcePayload() {
    const title = String(resourceForm.title || '').trim()
    const note = String(resourceForm.note || '').trim()
    const category = String(resourceForm.category || '').trim() || getDefaultCategoryName(resourceCategories)
    return {
      user_id: user.id,
      title,
      url: String(resourceForm.url || '').trim(),
      category,
      cover_url: String(resourceForm.cover_url || '').trim(),
      tags: normalizeTags(resourceForm.tags),
      note,
      description: note || title,
      slug: createResourceSlug(title),
      is_public: Boolean(resourceForm.is_public),
    }
  }

  async function saveResource(event) {
    event.preventDefault()
    const payload = buildResourcePayload()
    if (!payload.title || !payload.url) {
      notifyInfo('请填写标题和链接')
      return
    }

    setBusyKey(editingId || 'resource-create')

    if (editingId) {
      const updatePayload = {
        title: payload.title,
        url: payload.url,
        category: payload.category,
        cover_url: payload.cover_url,
        tags: payload.tags,
        note: payload.note,
        description: payload.description,
        is_public: payload.is_public,
      }

      let { error } = await supabase
        .from('resources')
        .update(updatePayload)
        .eq('id', editingId)

      if (error && /cover_url/i.test(String(error.message || ''))) {
        const { cover_url, ...fallbackPayload } = updatePayload
        const retry = await supabase
          .from('resources')
          .update(fallbackPayload)
          .eq('id', editingId)
        error = retry.error
        if (!error) notifyInfo('当前数据库缺少 cover_url 字段，已忽略封面保存')
      }

      setBusyKey('')
      if (error) {
        notifyError(`更新资源失败：${error.message}`)
        return
      }
      notifySuccess('资源更新成功')
      addLog('UPDATE_RESOURCE', payload.title)
    } else {
      let { error } = await supabase.from('resources').insert(payload)
      if (error && /cover_url/i.test(String(error.message || ''))) {
        const { cover_url, ...fallbackPayload } = payload
        const retry = await supabase.from('resources').insert(fallbackPayload)
        error = retry.error
        if (!error) notifyInfo('当前数据库缺少 cover_url 字段，已忽略封面保存')
      }
      setBusyKey('')
      if (error) {
        notifyError(`添加资源失败：${error.message}`)
        return
      }
      notifySuccess('资源添加成功')
      addLog('CREATE_RESOURCE', payload.title)
    }

    resetResourceForm()
    setResourceFormOpen(false)
    await Promise.all([refreshResources(), refreshStats()])
  }

  function editResource(item) {
    setEditingId(item.id)
    setResourceForm({
      title: item.title || '',
      url: item.url || '',
      category: item.category || getDefaultCategoryName(resourceCategories),
      cover_url: item.cover_url || '',
      tags: normalizeTags(item.tags).join(','),
      note: item.note || '',
      is_public: Boolean(item.is_public),
    })
    setResourceFormOpen(true)
  }

  async function deleteResource(item) {
    if (!window.confirm(`确定删除资源「${item.title}」吗？`)) return
    setBusyKey(item.id)
    const { data, error } = await supabase.from('resources').delete().eq('id', item.id).select('id')
    setBusyKey('')
    if (error) {
      notifyError(`删除资源失败：${error.message}`)
      return
    }
    if (!data || !data.length) {
      notifyError('删除资源失败：数据库未删除记录，请检查 RLS 策略')
      return
    }
    notifySuccess('资源已删除')
    addLog('DELETE_RESOURCE', item.title)
    await Promise.all([refreshResources(), refreshStats()])
  }

  function startEditCategory(item) {
    setCategoryEditingId(item.id)
    setCategoryDraft({
      name: item.name,
      emoji: item.emoji || '',
      sort_order: String(item.sort_order || 100),
    })
  }

  function resetCategoryDraft() {
    setCategoryEditingId('')
    setCategoryDraft({ name: '', emoji: '', sort_order: '' })
  }

  function choosePresetCategoryIcon(icon) {
    setCategoryDraft((prev) => ({ ...prev, emoji: icon }))
  }

  function triggerCustomCategoryIconUpload() {
    if (!categoryIconUploadRef.current) return
    categoryIconUploadRef.current.click()
  }

  function handleCustomCategoryIconUpload(event) {
    const file = event.target && event.target.files && event.target.files[0] ? event.target.files[0] : null
    if (!file) return

    if (!/^image\//i.test(file.type || '')) {
      notifyInfo('请上传图片文件（PNG/JPG/SVG/WebP）')
      event.target.value = ''
      return
    }

    const maxSize = 512 * 1024
    if (file.size > maxSize) {
      notifyInfo('图标请控制在 512KB 以内')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) {
        notifyError('读取图片失败，请重试')
        return
      }
      setCategoryDraft((prev) => ({ ...prev, emoji: dataUrl }))
      notifySuccess('自定义图标已加载')
    }
    reader.onerror = () => notifyError('读取图片失败，请重试')
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  async function saveCategory(event) {
    event.preventDefault()

    const name = String(categoryDraft.name || '').trim()
    const emoji = String(categoryDraft.emoji || '').trim() || '📁'
    const sortOrder = Number.parseInt(String(categoryDraft.sort_order || '').trim(), 10)

    if (!name) {
      notifyInfo('请填写分类名称')
      return
    }

    const payload = {
      name,
      emoji,
      sort_order: Number.isNaN(sortOrder) ? 100 : sortOrder,
      is_active: true,
    }

    setBusyKey('category-save')

    if (categoryEditingId) {
      const oldCategory = resourceCategories.find((item) => item.id === categoryEditingId)
      const oldName = oldCategory ? oldCategory.name : ''

      const { error: updateError } = await supabase
        .from('resource_categories')
        .update(payload)
        .eq('id', categoryEditingId)

      if (updateError) {
        setBusyKey('')
        notifyError(`分类保存失败：${updateError.message}`)
        return
      }

      if (oldName && oldName !== name) {
        const { error: resourceUpdateError } = await supabase
          .from('resources')
          .update({ category: name })
          .eq('category', oldName)

        if (resourceUpdateError) {
          setBusyKey('')
          notifyError(`资源分类同步失败：${resourceUpdateError.message}`)
          return
        }
      }

      addLog('UPDATE_CATEGORY', `${oldName || '分类'} -> ${name}`)
      notifySuccess('分类已更新')
    } else {
      const { error } = await supabase.from('resource_categories').insert(payload)
      if (error) {
        setBusyKey('')
        notifyError(`新增分类失败：${error.message}`)
        return
      }
      addLog('CREATE_CATEGORY', name)
      notifySuccess('分类已添加')
    }

    setBusyKey('')
    resetCategoryDraft()
    await Promise.all([refreshResourceCategories(), refreshResources()])
  }

  async function deleteCategory(item) {
    if (resourceCategories.length <= 1) {
      notifyInfo('至少保留一个分类，无法删除最后一个分类')
      return
    }

    const usage = resources.filter((resource) => String(resource.category || '').trim() === item.name).length
    const remainingCategories = resourceCategories.filter((category) => category.id !== item.id)
    const fallbackCategoryName = getDefaultCategoryName(remainingCategories)
    const confirmText = usage
      ? `分类「${item.name}」下有 ${usage} 条资源，删除后将归到“${fallbackCategoryName}”。确定继续吗？`
      : `确定删除分类「${item.name}」吗？`
    if (!window.confirm(confirmText)) return

    setBusyKey(`category-delete-${item.id}`)

    if (usage > 0) {
      const { error: updateError } = await supabase
        .from('resources')
        .update({ category: fallbackCategoryName })
        .eq('category', item.name)
      if (updateError) {
        setBusyKey('')
        notifyError(`资源迁移失败：${updateError.message}`)
        return
      }
    }

    const { error } = await supabase.from('resource_categories').delete().eq('id', item.id)
    setBusyKey('')
    if (error) {
      notifyError(`删除分类失败：${error.message}`)
      return
    }

    if (categoryEditingId === item.id) resetCategoryDraft()
    addLog('DELETE_CATEGORY', item.name)
    notifySuccess('分类已删除')
    await Promise.all([refreshResourceCategories(), refreshResources()])
  }

  async function changeMessageStatus(item, nextStatus) {
    if (!nextStatus || item.status === nextStatus) return
    setBusyKey(item.id)
    const { error } = await supabase
      .from('messages')
      .update({ status: nextStatus, is_done: nextStatus === 'done' })
      .eq('id', item.id)
    setBusyKey('')
    if (error) {
      notifyError(`更新状态失败：${error.message}`)
      return
    }
    setMessages((prev) => prev.map((msg) => (msg.id === item.id ? { ...msg, status: nextStatus } : msg)))
    notifySuccess('留言状态已更新')
    addLog('UPDATE_MESSAGE_STATUS', `${item.title} -> ${statusLabel(nextStatus)}`)
    await refreshStats()
  }

  async function deleteMessage(item) {
    if (!window.confirm(`确定删除留言「${item.title}」吗？`)) return
    setBusyKey(item.id)
    const { data, error } = await supabase.from('messages').delete().eq('id', item.id).select('id')
    setBusyKey('')
    if (error) {
      notifyError(`删除留言失败：${error.message}`)
      return
    }
    if (!data || !data.length) {
      notifyError('删除留言失败：数据库未删除记录，请检查 RLS 策略')
      return
    }
    setMessages((prev) => prev.filter((msg) => msg.id !== item.id))
    setRepliesByPost((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
    notifySuccess('留言已删除')
    addLog('DELETE_MESSAGE', item.title)
    await refreshStats()
  }

  function toggleReplyBox(messageId) {
    setReplyOpenMap((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  async function submitOfficialReply(item, event) {
    event.preventDefault()
    const content = String(officialReplyDrafts[item.id] || '').trim()
    if (!content) {
      notifyInfo('请输入回复内容')
      return
    }

    setBusyKey(`reply-${item.id}`)
    const { data, error } = await supabase
      .from('message_replies')
      .insert({ post_id: item.id, user_id: user.id, content, is_official: true })
      .select('id,post_id,user_id,content,is_official,created_at')
      .single()
    setBusyKey('')

    if (error) {
      notifyError(`发布官方回复失败：${error.message}`)
      return
    }

    setRepliesByPost((prev) => ({ ...prev, [item.id]: [...(prev[item.id] || []), data] }))
    setMessages((prev) => prev.map((msg) => (msg.id === item.id ? { ...msg, reply_count: msg.reply_count + 1 } : msg)))
    setOfficialReplyDrafts((prev) => ({ ...prev, [item.id]: '' }))
    notifySuccess('官方回复已发布')
    addLog('REPLY_MESSAGE', item.title)
  }

  async function deleteReply(item, reply) {
    if (!window.confirm('确定删除这条回复吗？')) return
    setBusyKey(reply.id)
    const { data, error } = await supabase.from('message_replies').delete().eq('id', reply.id).select('id')
    setBusyKey('')
    if (error) {
      notifyError(`删除回复失败：${error.message}`)
      return
    }
    if (!data || !data.length) {
      notifyError('删除回复失败：数据库未删除记录，请检查 RLS 策略')
      return
    }

    setRepliesByPost((prev) => ({
      ...prev,
      [item.id]: (prev[item.id] || []).filter((x) => x.id !== reply.id),
    }))
    setMessages((prev) => prev.map((msg) => (msg.id === item.id ? { ...msg, reply_count: Math.max(0, msg.reply_count - 1) } : msg)))
    notifySuccess('回复已删除')
    addLog('DELETE_REPLY', item.title)
  }

  async function toggleUserRole(row) {
    if (!row.roleKey) {
      notifyError('当前 profiles 表没有 role/user_role 字段，无法修改角色')
      return
    }
    const next = row.role === 'admin' ? 'user' : 'admin'
    const payload = {}
    payload[row.roleKey] = next

    setBusyKey(`user-role-${row.id}`)
    const { error } = await supabase.from('profiles').update(payload).eq('id', row.id)
    setBusyKey('')
    if (error) {
      notifyError(`更新用户角色失败：${error.message}`)
      return
    }

    setUsers((prev) => prev.map((item) => (item.id === row.id ? { ...item, role: next } : item)))
    notifySuccess(next === 'admin' ? '已设为管理员' : '已撤销管理员权限')
    addLog('UPDATE_USER_ROLE', `${row.email} -> ${next}`)
  }

  async function toggleUserStatus(row) {
    if (!row.statusKey) {
      notifyError('当前 profiles 表没有 status/account_status/disabled 字段，无法修改状态')
      return
    }

    const next = row.status === 'disabled' ? 'active' : 'disabled'
    const payload = {}
    if (row.statusKey === 'disabled') payload.disabled = next === 'disabled'
    else payload[row.statusKey] = next

    setBusyKey(`user-status-${row.id}`)
    const { error } = await supabase.from('profiles').update(payload).eq('id', row.id)
    setBusyKey('')
    if (error) {
      notifyError(`更新账号状态失败：${error.message}`)
      return
    }

    setUsers((prev) => prev.map((item) => (item.id === row.id ? { ...item, status: next } : item)))
    notifySuccess(next === 'disabled' ? '账号已禁用' : '账号已解封')
    addLog('UPDATE_USER_STATUS', `${row.email} -> ${next}`)
  }

  const resourceCategoryNames = useMemo(
    () => resourceCategories.map((item) => item.name).filter(Boolean),
    [resourceCategories],
  )

  const resourceCategoryOptions = useMemo(
    () => ['全部', ...resourceCategoryNames],
    [resourceCategoryNames],
  )

  const resourceFormCategoryOptions = useMemo(() => {
    const base = [...resourceCategoryNames]
    const current = String(resourceForm.category || '').trim()
    if (current && !base.includes(current)) return [current, ...base]
    return base
  }, [resourceCategoryNames, resourceForm.category])

  useEffect(() => {
    if (!resourceCategoryOptions.includes(resourceCategory)) {
      setResourceCategory('全部')
    }
  }, [resourceCategory, resourceCategoryOptions])

  useEffect(() => {
    if (editingId) return
    const defaultCategory = getDefaultCategoryName(resourceCategories)
    setResourceForm((prev) => {
      const current = String(prev.category || '').trim()
      if (current && resourceCategoryNames.includes(current)) return prev
      return { ...prev, category: defaultCategory }
    })
  }, [editingId, resourceCategories, resourceCategoryNames])

  const filteredResources = useMemo(() => {
    const k = String(resourceKeyword || '').trim().toLowerCase()
    return resources.filter((item) => {
      const c = resourceCategory === '全部' || String(item.category || '') === resourceCategory
      if (!c) return false
      if (!k) return true
      const text = `${item.title || ''} ${item.url || ''} ${(normalizeTags(item.tags) || []).join(' ')}`.toLowerCase()
      return text.includes(k)
    })
  }, [resources, resourceKeyword, resourceCategory])

  const categoryUsageMap = useMemo(
    () =>
      resources.reduce((acc, item) => {
        const key = String(item.category || '').trim()
        if (!key) return acc
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
    [resources],
  )

  const filteredMessages = useMemo(() => {
    const statusMatched =
      messageFilter === 'all' ? messages : messages.filter((item) => item.status === messageFilter)
    const keyword = String(messageKeyword || '').trim().toLowerCase()
    if (!keyword) return statusMatched
    return statusMatched.filter((item) => {
      const text = `${item.title || ''} ${item.content || ''} ${CATEGORY_LABEL[item.category] || ''}`.toLowerCase()
      return text.includes(keyword)
    })
  }, [messages, messageFilter, messageKeyword])

  const filteredUsers = useMemo(() => {
    const k = String(userKeyword || '').trim().toLowerCase()
    return users.filter((item) => {
      const roleMatched = userRoleFilter === 'all' || item.role === userRoleFilter
      if (!roleMatched) return false
      if (!k) return true
      return String(item.email || '').toLowerCase().includes(k)
    })
  }, [users, userKeyword, userRoleFilter])

  const filteredLogs = useMemo(() => {
    const start = logDateFrom ? new Date(`${logDateFrom}T00:00:00`).getTime() : null
    const end = logDateTo ? new Date(`${logDateTo}T23:59:59.999`).getTime() : null

    return actionLogs.filter((item) => {
      const current = new Date(item.created_at || '').getTime()
      if (Number.isNaN(current)) return false
      if (start !== null && current < start) return false
      if (end !== null && current > end) return false
      return true
    })
  }, [actionLogs, logDateFrom, logDateTo])

  const previewResources = useMemo(() => resources.slice(0, 5), [resources])
  const previewMessages = useMemo(() => messages.slice(0, 5), [messages])

  const resourceCategoryData = useMemo(() => {
    const counter = {}
    resources.forEach((item) => {
      const key = String(item.category || '').trim() || '未分类'
      counter[key] = (counter[key] || 0) + 1
    })
    return Object.keys(counter)
      .map((name) => ({ name, value: counter[name] }))
      .sort((a, b) => b.value - a.value)
  }, [resources])

  const resourceCategoryTotal = useMemo(
    () => resourceCategoryData.reduce((sum, item) => sum + item.value, 0),
    [resourceCategoryData],
  )

  const messageStatusData = useMemo(() => {
    const counter = { pending: 0, in_progress: 0, done: 0 }
    messages.forEach((item) => {
      const key = item.status === 'in_progress' || item.status === 'done' ? item.status : 'pending'
      counter[key] += 1
    })
    return [
      { key: 'pending', name: '待处理', value: counter.pending },
      { key: 'in_progress', name: '开发中', value: counter.in_progress },
      { key: 'done', name: '已完成', value: counter.done },
    ]
  }, [messages])

  const messageStatusTotal = useMemo(
    () => messageStatusData.reduce((sum, item) => sum + item.value, 0),
    [messageStatusData],
  )
  function renderOverview() {
    return (
      <div className="admin-v2-section-stack">
        <div className="admin-v2-stats-row">
          <div className="admin-v2-stat-card">
            <div className="admin-v2-stat-head">
              <span>资源总数</span>
              <i className="admin-v2-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.8"/><path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </i>
            </div>
            <strong className="accent-teal">{stats.resources}</strong>
          </div>
          <div className="admin-v2-stat-card">
            <div className="admin-v2-stat-head">
              <span>留言总数</span>
              <i className="admin-v2-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M6 18.5h8.8c2.32 0 4.2-1.83 4.2-4.08v-4.84C19 7.33 17.12 5.5 14.8 5.5H9.2C6.88 5.5 5 7.33 5 9.58v7.08L6 18.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 10.5h6M9 13.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </i>
            </div>
            <strong>{stats.messages}</strong>
          </div>
          <div className="admin-v2-stat-card">
            <div className="admin-v2-stat-head">
              <span>待处理留言</span>
              <i className="admin-v2-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8"/><path d="M12 8v4l2.6 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </i>
            </div>
            <strong className="accent-amber">{stats.pending}</strong>
          </div>
          <div className="admin-v2-stat-card">
            <div className="admin-v2-stat-head">
              <span>注册用户</span>
              <i className="admin-v2-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8"/><path d="M6 18c0-2.76 2.69-5 6-5s6 2.24 6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </i>
            </div>
            <strong>{stats.users}</strong>
          </div>
        </div>

        <div className="admin-v2-two-col">
          <section className="admin-v2-card">
            <div className="admin-v2-card-head">
              <h2>资源预览</h2>
              <div className="admin-v2-head-actions">
                <span className="admin-v2-pill">共 {stats.resources} 条</span>
                <NavLink to="/admin/resources" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm">查看全部</NavLink>
              </div>
            </div>
            <div className="admin-v2-preview-list">
              {!previewResources.length ? (
                <div className="admin-v2-empty admin-v2-empty-rich">
                  <span className="admin-v2-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  </span>
                  <p>还没有资源，去添加第一条</p>
                </div>
              ) : null}
              {previewResources.map((item) => <div key={item.id} className="admin-v2-preview-item"><strong>{item.title}</strong><span>{fmtTime(item.created_at)}</span></div>)}
            </div>
          </section>

          <section className="admin-v2-card">
            <div className="admin-v2-card-head">
              <h2>留言预览</h2>
              <div className="admin-v2-head-actions">
                <span className="admin-v2-pill">最近 5 条</span>
                <NavLink to="/admin/messages" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm">查看全部</NavLink>
              </div>
            </div>
            <div className="admin-v2-preview-list">
              {!previewMessages.length ? (
                <div className="admin-v2-empty admin-v2-empty-rich">
                  <span className="admin-v2-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M6 18.5h8.8c2.32 0 4.2-1.83 4.2-4.08v-4.84C19 7.33 17.12 5.5 14.8 5.5H9.2C6.88 5.5 5 7.33 5 9.58v7.08L6 18.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 10.5h6M9 13.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  </span>
                  <p>还没有留言，等待第一条反馈</p>
                </div>
              ) : null}
              {previewMessages.map((item) => <div key={item.id} className="admin-v2-preview-item"><strong>{item.title}</strong><span>{statusLabel(item.status)} · {fmtTime(item.created_at)}</span></div>)}
            </div>
          </section>
        </div>

        <div className="admin-v2-two-col admin-v2-chart-row">
          <section className="admin-v2-card admin-v2-chart-card">
            <div className="admin-v2-card-head">
              <h2>资源分类统计</h2>
              <span className="admin-v2-pill">共 {resourceCategoryTotal} 条</span>
            </div>
            <div className="admin-v2-chart-body">
              {!resourceCategoryTotal ? (
                <div className="admin-v2-chart-empty">暂无数据</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={resourceCategoryData} margin={{ top: 6, right: 10, left: -14, bottom: 8 }}>
                    <CartesianGrid stroke="#EEF2F7" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#6A7282', fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: '#D8E0EA' }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: '#6A7282', fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: '#D8E0EA' }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(29, 158, 117, 0.08)' }}
                      formatter={(value) => [`${value} 条`, '数量']}
                      contentStyle={{ borderRadius: '10px', border: '1px solid #D9DEE6' }}
                    />
                    <Bar dataKey="value" fill="#1D9E75" radius={[6, 6, 0, 0]} activeBar={{ fill: '#178663' }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="admin-v2-card admin-v2-chart-card">
            <div className="admin-v2-card-head">
              <h2>留言状态分布</h2>
              <span className="admin-v2-pill">共 {messageStatusTotal} 条</span>
            </div>
            <div className="admin-v2-chart-body">
              {!messageStatusTotal ? (
                <div className="admin-v2-chart-empty">暂无数据</div>
              ) : (
                <div className="admin-v2-donut-layout">
                  <div className="admin-v2-donut-wrap">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={messageStatusData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={58}
                          outerRadius={86}
                          paddingAngle={2}
                          stroke="#fff"
                          strokeWidth={2}
                        >
                          {messageStatusData.map((item) => (
                            <Cell key={item.key} fill={MESSAGE_STATUS_COLOR_MAP[item.key]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) => [`${value} 条`, '数量']}
                          contentStyle={{ borderRadius: '10px', border: '1px solid #D9DEE6' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="admin-v2-donut-center">
                      <strong>{messageStatusTotal}</strong>
                      <span>总留言</span>
                    </div>
                  </div>

                  <div className="admin-v2-chart-legend">
                    {messageStatusData.map((item) => {
                      const percent = messageStatusTotal
                        ? ((item.value / messageStatusTotal) * 100).toFixed(0)
                        : '0'
                      return (
                        <div key={item.key} className="admin-v2-chart-legend-item">
                          <span className="admin-v2-chart-dot" style={{ background: MESSAGE_STATUS_COLOR_MAP[item.key] }} />
                          <span>{item.name}</span>
                          <strong>{item.value} 条</strong>
                          <em>{percent}%</em>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    )
  }

  function renderResources() {
    return (
      <div className="admin-v2-section-stack">
        <section className="admin-v2-card admin-v2-category-card">
          <div className="admin-v2-toolbar">
            <div className="admin-v2-filter-group admin-v2-filter-group-resource">
              <div className="admin-v2-filter-item">
                <input className="admin-v2-input" value={resourceKeyword} onChange={(e) => setResourceKeyword(e.target.value)} placeholder="搜索标题、链接、标签" />
              </div>
              <div className="admin-v2-filter-divider" />
              <div className="admin-v2-filter-item">
                <select className="admin-v2-select" value={resourceCategory} onChange={(e) => setResourceCategory(e.target.value)}>
                  {resourceCategoryOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
            </div>
            <div className="admin-v2-head-actions">
              <span className="admin-v2-pill">共 {filteredResources.length} 条</span>
              <button type="button" className="admin-v2-btn admin-v2-btn-primary admin-v2-btn-sm" onClick={openCreateResourceForm}>添加资源</button>
            </div>
          </div>
          <div className="admin-v2-table-wrap">
            <table className="admin-v2-table">
              <thead><tr><th>封面</th><th>标题</th><th>分类</th><th>标签</th><th>是否公开</th><th>添加时间</th><th>操作</th></tr></thead>
              <tbody>
                {!filteredResources.length ? <tr><td colSpan={7} className="empty-cell">暂无资源，从左侧添加第一条吧</td></tr> : null}
                {filteredResources.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.cover_url ? (
                        <span className="admin-v2-resource-cover-thumb"><img src={item.cover_url} alt="" /></span>
                      ) : (
                        <span className="admin-v2-resource-cover-placeholder">-</span>
                      )}
                    </td>
                    <td><a className="admin-v2-link" href={item.url} target="_blank" rel="noreferrer">{item.title}</a></td>
                    <td>{item.category || '-'}</td>
                    <td>{normalizeTags(item.tags).join(', ') || '-'}</td>
                    <td><span className={`admin-v2-badge ${item.is_public ? 'is-public' : 'is-private'}`}>{item.is_public ? '公开' : '私有'}</span></td>
                    <td>{fmtTime(item.created_at)}</td>
                    <td><div className="admin-v2-row-actions"><button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={() => editResource(item)}>编辑</button><button type="button" className="admin-v2-btn admin-v2-btn-danger admin-v2-btn-sm" disabled={busyKey === item.id} onClick={() => deleteResource(item)}>删除</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-v2-card admin-v2-category-card">
          <div className="admin-v2-card-head">
            <h2>分类管理</h2>
            <span className="admin-v2-pill">共 {resourceCategories.length} 个</span>
          </div>

          <form className="admin-v2-form admin-v2-category-form" onSubmit={saveCategory}>
            <div className="admin-v2-form-row three-col">
              <label><span>分类名称</span><input value={categoryDraft.name} onChange={(e) => setCategoryDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="如：工具" required /></label>
              <label className="admin-v2-category-icon-field">
                <span>图标</span>
                <div className="admin-v2-category-icon-head">
                  <span className="admin-v2-category-icon-preview">
                    <CategoryIcon value={categoryDraft.emoji || '📁'} />
                  </span>
                  <button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={triggerCustomCategoryIconUpload}>上传图标</button>
                  <input
                    ref={categoryIconUploadRef}
                    type="file"
                    accept="image/*"
                    className="admin-v2-hidden-file"
                    onChange={handleCustomCategoryIconUpload}
                  />
                </div>
                <div className="admin-v2-icon-preset-grid">
                  {CATEGORY_ICON_PRESETS.map((item) => (
                    <button
                      key={`${item.label}-${item.icon}`}
                      type="button"
                      className={`admin-v2-icon-chip ${String(categoryDraft.emoji || '').trim() === item.icon ? 'active' : ''}`}
                      onClick={() => choosePresetCategoryIcon(item.icon)}
                    >
                      <span>{item.icon}</span>
                      <em>{item.label}</em>
                    </button>
                  ))}
                </div>
              </label>
              <label><span>排序</span><input value={categoryDraft.sort_order} onChange={(e) => setCategoryDraft((prev) => ({ ...prev, sort_order: e.target.value }))} placeholder="100" /></label>
            </div>
            <div className="admin-v2-form-actions">
              {categoryEditingId ? <button type="button" className="admin-v2-btn admin-v2-btn-outline" onClick={resetCategoryDraft}>取消编辑</button> : null}
              <button type="submit" className="admin-v2-btn admin-v2-btn-primary" disabled={busyKey === 'category-save'}>{categoryEditingId ? '保存分类' : '添加分类'}</button>
            </div>
          </form>

          <div className="admin-v2-table-wrap">
            <table className="admin-v2-table">
              <thead><tr><th>图标</th><th>名称</th><th>排序</th><th>资源数</th><th>操作</th></tr></thead>
              <tbody>
                {!resourceCategories.length ? <tr><td colSpan={5} className="empty-cell">暂无分类，请先添加</td></tr> : null}
                {resourceCategories.map((item) => (
                  <tr key={item.id}>
                    <td><span className="admin-v2-category-icon-cell"><CategoryIcon value={item.emoji || '📁'} /></span></td>
                    <td>{item.name}</td>
                    <td>{item.sort_order}</td>
                    <td>{categoryUsageMap[item.name] || 0}</td>
                    <td>
                      <div className="admin-v2-row-actions">
                        <button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={() => startEditCategory(item)}>编辑</button>
                        <button type="button" className="admin-v2-btn admin-v2-btn-danger-soft admin-v2-btn-sm" disabled={busyKey === `category-delete-${item.id}`} onClick={() => deleteCategory(item)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {resourceFormOpen ? (
          <div className="admin-v2-modal-backdrop" onClick={closeResourceForm}>
            <section className="admin-v2-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="admin-v2-card-head">
                <h2>{editingId ? '编辑资源' : '添加资源'}</h2>
                <button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={closeResourceForm}>关闭</button>
              </div>
              <form className="admin-v2-form" onSubmit={saveResource}>
                <div className="admin-v2-form-row two-col ratio-7-3">
                  <label><span>标题</span><input value={resourceForm.title} onChange={(e) => updateResourceForm('title', e.target.value)} placeholder="资源标题" required /></label>
                  <label><span>分类</span><select value={resourceForm.category} onChange={(e) => updateResourceForm('category', e.target.value)}>{resourceFormCategoryOptions.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                </div>
                <label><span>链接</span><input value={resourceForm.url} onChange={(e) => updateResourceForm('url', e.target.value)} placeholder="https://" required /></label>
                <label className="admin-v2-resource-cover-field">
                  <span>封面图</span>
                  <div className="admin-v2-resource-cover-head">
                    <input value={resourceForm.cover_url} onChange={(e) => updateResourceForm('cover_url', e.target.value)} placeholder="封面图链接（可选）" />
                    <button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={triggerResourceCoverUpload}>上传图片</button>
                    <input
                      ref={resourceCoverUploadRef}
                      type="file"
                      accept="image/*"
                      className="admin-v2-hidden-file"
                      onChange={handleResourceCoverUpload}
                    />
                  </div>
                  {resourceForm.cover_url ? (
                    <span className="admin-v2-resource-cover-preview">
                      <img src={resourceForm.cover_url} alt="封面预览" />
                    </span>
                  ) : null}
                </label>
                <label><span>标签（逗号分隔）</span><input value={resourceForm.tags} onChange={(e) => updateResourceForm('tags', e.target.value)} placeholder="设计, 效率, AI" /></label>
                <label><span>备注</span><textarea rows={3} value={resourceForm.note} onChange={(e) => updateResourceForm('note', e.target.value)} placeholder="简短描述这个资源..." /></label>
                <label className="admin-v2-check-row"><input type="checkbox" checked={resourceForm.is_public} onChange={(e) => updateResourceForm('is_public', e.target.checked)} /><span>公开发布</span></label>
                <div className="admin-v2-form-actions">
                  <button type="button" className="admin-v2-btn admin-v2-btn-outline" onClick={closeResourceForm}>取消</button>
                  <button type="submit" className="admin-v2-btn admin-v2-btn-primary" disabled={busyKey === (editingId || 'resource-create')}>{editingId ? '保存修改' : '添加资源'}</button>
                </div>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    )
  }

  function renderMessages() {
    return (
      <div className="admin-v2-section-stack">
        <section className="admin-v2-card">
          <div className="admin-v2-card-head">
            <h2>留言管理</h2>
            <span className="admin-v2-pill">共 {filteredMessages.length} 条</span>
          </div>

          <div className="admin-v2-toolbar admin-v2-message-toolbar">
            <div className="admin-v2-tabs">{MESSAGE_FILTERS.map((tab) => <button key={tab.value} type="button" className={`admin-v2-tab ${messageFilter === tab.value ? 'active' : ''}`} onClick={() => setMessageFilter(tab.value)}>{tab.label}</button>)}</div>
            <label className="admin-v2-message-search" aria-label="搜索留言">
              <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="M16 16l4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              <input value={messageKeyword} onChange={(e) => setMessageKeyword(e.target.value)} placeholder="搜索标题、正文、分类" />
            </label>
          </div>

          <div className="admin-v2-message-list">
            {!filteredMessages.length ? (
              <div className="admin-v2-empty admin-v2-empty-rich">
                <span className="admin-v2-empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M6 18.5h8.8c2.32 0 4.2-1.83 4.2-4.08v-4.84C19 7.33 17.12 5.5 14.8 5.5H9.2C6.88 5.5 5 7.33 5 9.58v7.08L6 18.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 10.5h6M9 13.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </span>
                <p>暂无符合条件的留言，试试切换筛选或修改关键词</p>
              </div>
            ) : null}
            {filteredMessages.map((item) => {
              const replies = repliesByPost[item.id] || []
              const opened = Boolean(replyOpenMap[item.id])
              return (
                <article key={item.id} className="admin-v2-message-card">
                  <div className="admin-v2-message-head"><h3>{item.title}</h3><div className="admin-v2-badges"><span className="admin-v2-badge neutral">{CATEGORY_LABEL[item.category] || '其他'}</span><span className={`admin-v2-badge status-${item.status}`}>{statusLabel(item.status)}</span></div></div>
                  <p className="admin-v2-message-content">{item.content || '（无详细描述）'}</p>
                  <div className="admin-v2-message-meta"><span>用户：{item.user_id ? `User_${String(item.user_id).slice(0, 5)}` : '匿名用户'}</span><span>发布：{fmtTime(item.created_at)}</span><span>投票：{item.vote_count}</span><span>回复：{item.reply_count}</span></div>
                  <div className="admin-v2-message-actions">
                    <select value={item.status} onChange={(e) => changeMessageStatus(item, e.target.value)} disabled={busyKey === item.id}>{MESSAGE_STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select>
                    <button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={() => toggleReplyBox(item.id)}>{opened ? '收起回复' : '回复'}</button>
                    <button type="button" className="admin-v2-btn admin-v2-btn-danger admin-v2-btn-sm" disabled={busyKey === item.id} onClick={() => deleteMessage(item)}>删除留言</button>
                  </div>

                  {opened ? (
                    <div className="admin-v2-reply-box">
                      <div className="admin-v2-reply-title">官方回复</div>
                      <div className="admin-v2-reply-list">
                        {!replies.length ? <div className="admin-v2-empty mini">暂无回复</div> : null}
                        {replies.map((reply) => (
                          <div key={reply.id} className="admin-v2-reply-item">
                            <div className="admin-v2-reply-meta"><span>{reply.is_official ? '官方回复' : userAlias(reply.user_id)}</span><span>{fmtTime(reply.created_at)}</span></div>
                            <p>{reply.content}</p>
                            <div className="admin-v2-card-actions-right"><button type="button" className="admin-v2-btn admin-v2-btn-danger admin-v2-btn-sm" disabled={busyKey === reply.id} onClick={() => deleteReply(item, reply)}>删除回复</button></div>
                          </div>
                        ))}
                      </div>
                      <form className="admin-v2-reply-form" onSubmit={(e) => submitOfficialReply(item, e)}>
                        <textarea rows={2} value={officialReplyDrafts[item.id] || ''} onChange={(e) => setOfficialReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))} placeholder="输入官方回复..." />
                        <div className="admin-v2-reply-form-actions"><button type="submit" className="admin-v2-btn admin-v2-btn-primary admin-v2-btn-sm" disabled={busyKey === `reply-${item.id}`}>发布回复</button></div>
                      </form>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>
      </div>
    )
  }

  function renderUsers() {
    return (
      <div className="admin-v2-section-stack">
        <section className="admin-v2-card">
          <div className="admin-v2-toolbar">
            <div className="admin-v2-filter-group">
              <input className="admin-v2-input" value={userKeyword} onChange={(e) => setUserKeyword(e.target.value)} placeholder="搜索邮箱" />
              <select className="admin-v2-select" value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value)}>
                <option value="all">全部角色</option>
                <option value="admin">管理员</option>
                <option value="user">普通用户</option>
              </select>
            </div>
            <span className="admin-v2-pill">共 {filteredUsers.length} 人</span>
          </div>
          <div className="admin-v2-table-wrap">
            <table className="admin-v2-table">
              <thead><tr><th>邮箱</th><th>角色</th><th>注册时间</th><th>账号状态</th><th>操作</th></tr></thead>
              <tbody>
                {!filteredUsers.length ? <tr><td colSpan={5} className="empty-cell">暂无可管理用户（请确认 profiles 表存在）</td></tr> : null}
                {filteredUsers.map((item) => {
                  const roleClass = item.role === 'admin' ? 'role-admin' : 'role-user'
                  const roleText = item.role === 'admin' ? '管理员' : '普通用户'
                  const statusClass = item.status === 'disabled' ? 'status-disabled' : 'status-active'
                  const statusText = item.status === 'disabled' ? '已禁用' : '正常'
                  return (
                    <tr key={item.id}>
                      <td>{item.email}</td>
                      <td><span className={`admin-v2-badge ${roleClass}`}>{roleText}</span></td>
                      <td>{fmtTime(item.created_at)}</td>
                      <td><span className={`admin-v2-badge ${statusClass}`}>{statusText}</span></td>
                      <td>
                        <div className="admin-v2-row-actions admin-v2-user-actions">
                          <button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" disabled={busyKey === `user-role-${item.id}`} onClick={() => toggleUserRole(item)}>{item.role === 'admin' ? '撤销权限' : '设为管理员'}</button>
                          <button type="button" className="admin-v2-btn admin-v2-btn-danger-soft admin-v2-btn-sm" disabled={busyKey === `user-status-${item.id}`} onClick={() => toggleUserStatus(item)}>{item.status === 'disabled' ? '解封' : '禁用'}</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  function renderLogs() {
    return (
      <div className="admin-v2-section-stack">
        <section className="admin-v2-card">
          <div className="admin-v2-card-head"><h2>操作日志</h2><span className="admin-v2-pill">共 {filteredLogs.length} 条</span></div>

          <div className="admin-v2-toolbar admin-v2-log-toolbar">
            <div className="admin-v2-filter-group admin-v2-log-range">
              <label>
                <span>开始日期</span>
                <input type="date" className="admin-v2-input" value={logDateFrom} onChange={(e) => setLogDateFrom(e.target.value)} />
              </label>
              <label>
                <span>结束日期</span>
                <input type="date" className="admin-v2-input" value={logDateTo} onChange={(e) => setLogDateTo(e.target.value)} />
              </label>
            </div>
            <button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={() => { setLogDateFrom(''); setLogDateTo('') }}>清空筛选</button>
          </div>

          {!filteredLogs.length ? <div className="admin-v2-empty">暂无日志记录</div> : null}
          {filteredLogs.length ? (
            <div className="admin-v2-table-wrap">
              <table className="admin-v2-table">
                <thead><tr><th>时间</th><th>操作类型</th><th>操作对象</th></tr></thead>
                <tbody>{filteredLogs.map((log) => <tr key={log.id}><td>{fmtTime(log.created_at)}</td><td>{log.type}</td><td>{log.target}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    )
  }

  let content = renderOverview()
  if (section === 'resources') content = renderResources()
  if (section === 'messages') content = renderMessages()
  if (section === 'users') content = renderUsers()
  if (section === 'logs') content = renderLogs()

  return (
    <main className="admin-v2-page">
      <div className="admin-v2-layout">
        <aside className="admin-v2-sidebar">
          <div className="admin-v2-logo-wrap">
            <Link to="/" className="admin-v2-logo"><span className="admin-v2-logo-dot" /><span>Collecta</span><span className="admin-v2-logo-badge">Admin</span></Link>
          </div>

          <nav className="admin-v2-nav">
            {ADMIN_MENU.map((item) => <NavLink key={item.key} to={item.to} className={({ isActive }) => `admin-v2-nav-item ${isActive ? 'active' : ''}`}>{item.label}</NavLink>)}
          </nav>

          <div className="admin-v2-userbox"><p>{user.email}</p><button type="button" className="admin-v2-logout" onClick={onLogout}>退出登录</button></div>
        </aside>

        <section className="admin-v2-main">
          <header className="admin-v2-topbar">
            <h1>{TITLE_MAP[section] || '概览'}</h1>
            <div className="admin-v2-topbar-actions"><button type="button" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm" onClick={refreshAll}>刷新数据</button><Link to="/" className="admin-v2-btn admin-v2-btn-outline admin-v2-btn-sm">返回前台</Link></div>
          </header>

          <div className="admin-v2-content">
            {errorText ? <p className="admin-v2-status-text error">{errorText}</p> : null}
            {content}
          </div>
        </section>
      </div>
    </main>
  )
}







