import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { extractRole } from './lib/authRole'
import Navbar from './components/Navbar'
import SiteFooter from './components/SiteFooter'
import ErrorBoundary from './components/ErrorBoundary'
import ToastHost from './components/ToastHost'

const Home = lazy(() => import('./pages/Home'))
const Categories = lazy(() => import('./pages/Categories'))
const CategoryResources = lazy(() => import('./pages/CategoryResources'))
const Favorites = lazy(() => import('./pages/Favorites'))
const Messages = lazy(() => import('./pages/Messages'))
const Login = lazy(() => import('./pages/Login'))
const Admin = lazy(() => import('./pages/Admin'))
const AdminLogin = lazy(() => import('./pages/AdminLogin'))

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
      {!isAdminSection ? <Navbar user={user} isGuest={isGuest} onLogout={handleLogout} /> : null}
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
