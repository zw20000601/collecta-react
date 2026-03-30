import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { notifyError, notifyInfo, notifySuccess } from '../lib/notify'

const TABS = [
  { key: 'login', label: '登录' },
  { key: 'register', label: '注册' },
]

export default function Login({ user, onEnterGuest }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = useMemo(() => params.get('redirect') || '/', [params])

  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) navigate(redirect, { replace: true })
  }, [user, navigate, redirect])

  async function onSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setStatus('')

    if (tab === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        const msg = `登录失败：${error.message}`
        setStatus(msg)
        notifyError(msg)
      } else {
        notifySuccess('登录成功')
        navigate(redirect, { replace: true })
      }
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
      const msg = `注册失败：${error.message}`
      setStatus(msg)
      notifyError(msg)
    } else {
      const msg = '注册成功，请检查邮箱验证；如已关闭邮箱验证可直接登录。'
      setStatus(msg)
      notifySuccess('注册请求已提交')
    }
    setLoading(false)
  }

  function enterGuest() {
    if (typeof onEnterGuest === 'function') {
      onEnterGuest()
    }
    notifyInfo('已进入游客模式')
    navigate('/categories')
  }

  return (
    <main className="page login-page">
      <div className="floating-bg" aria-hidden>
        {[...Array(7)].map((_, idx) => (
          <motion.span
            key={idx}
            className="bg-bubble"
            initial={{ y: 20, opacity: 0.2 }}
            animate={{ y: [-10, 14, -10], opacity: [0.2, 0.5, 0.2] }}
            transition={{ duration: 6 + idx, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.3 }}
            style={{ left: `${8 + idx * 13}%`, top: `${10 + (idx % 3) * 22}%` }}
          />
        ))}
      </div>

      <motion.section
        className="login-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <h1>Collecta 账户</h1>
        <p>登录后可收藏、留言和同步你的资源。</p>

        <div className="tab-switcher">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`tab-btn ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
          <motion.div
            className="tab-pill"
            animate={{ left: tab === 'login' ? '0%' : '50%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          />
        </div>

        <AnimatePresence mode="wait">
          <motion.form
            key={tab}
            className="auth-form"
            onSubmit={onSubmit}
            initial={{ opacity: 0, x: tab === 'login' ? -16 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tab === 'login' ? 16 : -16 }}
            transition={{ duration: 0.25 }}
          >
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
              />
            </label>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              className="submit-btn"
              type="submit"
              disabled={loading}
            >
              {loading ? '处理中...' : tab === 'login' ? '登录' : '注册'}
            </motion.button>
          </motion.form>
        </AnimatePresence>

        {status ? <p className="form-status">{status}</p> : null}

        <button type="button" className="ghost-btn login-guest-btn" onClick={enterGuest}>
          以游客身份浏览资源广场
        </button>
      </motion.section>
    </main>
  )
}
