import React from 'react'
import { Link } from 'react-router-dom'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error && error.message ? error.message : 'Unknown error',
    }
  }

  componentDidCatch(error, info) {
    // Keep this for diagnostics in production logs.
    // eslint-disable-next-line no-console
    console.error('Collecta boundary caught error:', error, info)
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <main className="page">
        <section className="section-block">
          <div className="container">
            <div className="error-card">
              <h1>页面出现异常</h1>
              <p>抱歉，当前页面运行出错。你可以刷新后重试。</p>
              <p className="error-msg">{this.state.message}</p>
              <div className="error-actions">
                <button type="button" className="nav-cta" onClick={this.handleReload}>刷新页面</button>
                <Link to="/" className="ghost-btn">返回首页</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    )
  }
}
