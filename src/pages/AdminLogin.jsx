import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { extractRole } from '../lib/authRole'

export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentRole, setCurrentRole] = useState('')

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return

      const session = data && data.session ? data.session : null
      const user = session && session.user ? session.user : null
      const role = extractRole(user, session)
      setCurrentRole(String(role || ''))

      if (user && String(role || '').toLowerCase() === 'admin') {
        navigate('/admin/overview', { replace: true })
      }
    }

    checkSession()

    return () => {
      mounted = false
    }
  }, [navigate])

  async function onSubmit(event) {
    event.preventDefault()
    setError('')

    const safeEmail = String(email || '').trim().toLowerCase()
    if (!safeEmail || !password) {
      setError('请输入管理员邮箱和密码')
      return
    }

    setLoading(true)
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: safeEmail, password })
    setLoading(false)

    if (signInError) {
      setError(`登录失败：${signInError.message}`)
      return
    }

    const session = data && data.session ? data.session : null
    const user = data && data.user ? data.user : null
    const role = extractRole(user, session)

    if (!user || String(role || '').toLowerCase() !== 'admin') {
      setError('无权限：当前账号不是管理员角色（role !== admin）')
      await supabase.auth.signOut()
      return
    }

    navigate('/admin/overview', { replace: true })
  }

  return (
    <main className="page login-page">
      <section className="login-card" style={{ maxWidth: 560 }}>
        <h1>后台登录</h1>
        <p>仅管理员角色可进入后台（JWT role = admin）。</p>
        {currentRole ? <p className="mini-status">当前会话角色：{currentRole}</p> : null}

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            管理员邮箱
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入管理员邮箱"
              autoComplete="username"
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
              autoComplete="current-password"
              required
            />
          </label>

          <button className="submit-btn" type="submit" disabled={loading}>
            {loading ? '登录中...' : '进入后台'}
          </button>
        </form>

        {error ? <p className="form-status">{error}</p> : null}

        <p style={{ marginTop: 12 }}>
          <Link className="inline-link" to="/">返回前台</Link>
        </p>
      </section>
    </main>
  )
}
