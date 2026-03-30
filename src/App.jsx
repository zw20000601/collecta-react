import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { extractRole } from './lib/authRole'
import Navbar from './components/Navbar'
import SiteFooter from './components/SiteFooter'
import ErrorBoundary from './components/ErrorBoundary'
import ToastHost from './components/ToastHost'

const loadHome = () => import('./pages/Home')
const loadCategories = () => import('./pages/Categories')
const loadCategoryResources = () => import('./pages/CategoryResources')
const loadFavorites = () => import('./pages/Favorites')
const loadMessages = () => import('./pages/Messages')
const loadLogin = () => import('./pages/Login')
const loadAdmin = () => import('./pages/Admin')
const loadAdminLogin = () => import('./pages/AdminLogin')

const Home = lazy(loadHome)
const Categories = lazy(loadCategories)
const CategoryResources = lazy(loadCategoryResources)
const Favorites = lazy(loadFavorites)
const Messages = lazy(loadMessages)
const Login = lazy(loadLogin)
const Admin = lazy(loadAdmin)
const AdminLogin = lazy(loadAdminLogin)

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    }),
  ])
}

function ProtectedRoute({ user, children }) {
  if (!user) return <Navigate to="/login?redirect=/favorites" replace />
  return children
}

export default function App() {
  const location = useLocation()
  const [user, setUser] = useState(null)
  const [authRole, setAuthRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [isGuest, setIsGuest] = useState(() => sessionStorage.getItem('isGuest') === 'true')

  const isAdmin = Boolean(user && String(authRole || '').toLowerCase() === 'admin')
  const isAdminSection = location.pathname.startsWith('/admin')

  function prefetchRoute(routePath) {
    const path = String(routePath || '')
    if (!path) return

    if (path === '/') {
      loadHome().catch(() => {})
      return
    }

    if (path === '/categories') {
      loadCategories().catch(() => {})
      return
    }

    if (path.startsWith('/categories/')) {
      loadCategoryResources().catch(() => {})
      return
    }

    if (path === '/favorites') {
      loadFavorites().catch(() => {})
      return
    }

    if (path === '/messages') {
      loadMessages().catch(() => {})
      return
    }

    if (path === '/login') {
      loadLogin().catch(() => {})
      return
    }

    if (path.startsWith('/admin')) {
      loadAdminLogin().catch(() => {})
      if (isAdmin) loadAdmin().catch(() => {})
    }
  }

  useEffect(() => {
    let mounted = true

    async function bootstrap() {
      let sessionData = { session: null }
      let userData = { user: null }

      try {
        const [sessionRes, userRes] = await Promise.all([
          withTimeout(supabase.auth.getSession(), 8000, 'getSession'),
          withTimeout(supabase.auth.getUser(), 8000, 'getUser'),
        ])
        sessionData = sessionRes && sessionRes.data ? sessionRes.data : { session: null }
        userData = userRes && userRes.data ? userRes.data : { user: null }
      } catch (error) {
        console.error('[auth] bootstrap failed:', error)
      }

      if (!mounted) return

      const session = sessionData && sessionData.session ? sessionData.session : null
      const nextUser = userData && userData.user ? userData.user : null
      setUser(nextUser)
      setAuthRole(extractRole(nextUser, session))

      if (nextUser) {
        sessionStorage.removeItem('isGuest')
        setIsGuest(false)
      }

      setLoading(false)
    }

    bootstrap()

    let authListener = null
    try {
      const listenerRes = supabase.auth.onAuthStateChange((_event, session) => {
        const nextUser = session && session.user ? session.user : null
        setUser(nextUser)
        setAuthRole(extractRole(nextUser, session))
        if (nextUser) {
          sessionStorage.removeItem('isGuest')
          setIsGuest(false)
        }
      })
      authListener = listenerRes && listenerRes.data ? listenerRes.data : null
    } catch (error) {
      console.error('[auth] onAuthStateChange failed:', error)
    }

    return () => {
      mounted = false
      if (authListener && authListener.subscription) {
        authListener.subscription.unsubscribe()
      }
    }
  }, [])

  useEffect(() => {
    if (loading) return undefined

    let idleId = null
    let timerId = null
    const warmup = () => {
      loadHome().catch(() => {})
      loadCategories().catch(() => {})
      loadCategoryResources().catch(() => {})
      loadFavorites().catch(() => {})
      loadMessages().catch(() => {})
      loadLogin().catch(() => {})
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(warmup, { timeout: 2000 })
    } else {
      timerId = window.setTimeout(warmup, 1000)
    }

    return () => {
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timerId !== null) {
        window.clearTimeout(timerId)
      }
    }
  }, [loading])

  async function handleLogout() {
    await supabase.auth.signOut()
    sessionStorage.removeItem('isGuest')
    setIsGuest(false)
  }

  function handleEnterGuest() {
    sessionStorage.setItem('isGuest', 'true')
    setIsGuest(true)
  }

  if (loading) {
    return <div className="page-loading">Collecta 正在连接中...</div>
  }

    return (
    <ErrorBoundary>
      {!isAdminSection ? <Navbar user={user} isGuest={isGuest} onLogout={handleLogout} onPrefetchRoute={prefetchRoute} /> : null}
      <Suspense fallback={<div className="page-loading">页面加载中...</div>}>
        <Routes>
          <Route path="/" element={<Home user={user} isGuest={isGuest} />} />
          <Route path="/categories" element={<Categories user={user} isGuest={isGuest} />} />
          <Route path="/categories/:categoryName" element={<CategoryResources user={user} isGuest={isGuest} />} />
          <Route
            path="/favorites"
            element={(
              <ProtectedRoute user={user}>
                <Favorites user={user} />
              </ProtectedRoute>
            )}
          />
          <Route path="/messages" element={<Messages user={user} isGuest={isGuest} />} />
          <Route path="/login" element={<Login user={user} onEnterGuest={handleEnterGuest} />} />
          <Route
            path="/admin/*"
            element={
              user ? (
                isAdmin ? <Admin user={user} onLogout={handleLogout} /> : <AdminLogin />
              ) : (
                <AdminLogin />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {!isAdminSection ? <SiteFooter /> : null}
      <ToastHost />
    </ErrorBoundary>
  )
}
