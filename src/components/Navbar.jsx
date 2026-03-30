import { Link, NavLink, useLocation } from 'react-router-dom'

export default function Navbar({ user, isGuest, onLogout, onPrefetchRoute }) {
  const location = useLocation()

  const userText = user
    ? user.email
    : isGuest
    ? '\u6e38\u5ba2\u6a21\u5f0f'
    : '\u672a\u767b\u5f55'

  const statusText = user
    ? '\u5df2\u767b\u5f55'
    : isGuest
    ? '\u6e38\u5ba2\u6d4f\u89c8'
    : '\u8bf7\u5148\u767b\u5f55'

  function getPrefetchHandlers(path) {
    if (!onPrefetchRoute) return {}
    const run = () => onPrefetchRoute(path)
    return {
      onMouseEnter: run,
      onFocus: run,
      onTouchStart: run,
    }
  }

  return (
    <nav className="top-nav">
      <div className="nav-inner">
        <Link to="/" className="logo" {...getPrefetchHandlers('/')}>
          <span className="logo-dot">{'\u25c9'}</span>
          Collecta
        </Link>

        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)} {...getPrefetchHandlers('/')}>{'\u9996\u9875'}</NavLink>
          <NavLink to="/categories" className={({ isActive }) => (isActive ? 'active' : undefined)} {...getPrefetchHandlers('/categories')}>{'\u8d44\u6e90\u5e7f\u573a'}</NavLink>
          <NavLink to="/favorites" className={({ isActive }) => (isActive ? 'active' : undefined)} {...getPrefetchHandlers('/favorites')}>{'\u6536\u85cf\u5939'}</NavLink>
          <NavLink to="/messages" className={({ isActive }) => (isActive ? 'active' : undefined)} {...getPrefetchHandlers('/messages')}>{'\u7559\u8a00\u677f'}</NavLink>
        </div>

        <div className="nav-right">
          <span className="user-pill">{userText}</span>
          <span className={`status-pill ${user ? 'success' : isGuest ? 'info' : 'warn'}`}>{statusText}</span>
          {user ? (
            <button type="button" className="nav-cta" onClick={onLogout}>{'\u9000\u51fa\u767b\u5f55'}</button>
          ) : (
            <Link className="nav-cta" to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} {...getPrefetchHandlers('/login')}>
              {'\u767b\u5f55'}
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
