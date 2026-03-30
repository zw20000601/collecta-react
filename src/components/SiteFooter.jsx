import { Link } from 'react-router-dom'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Link to="/" className="site-footer-logo">
            <svg className="site-footer-logo-icon" viewBox="0 0 40 40" fill="none" aria-hidden>
              <circle cx="20" cy="20" r="18" fill="#E1F5EE" stroke="#1B2A4A" strokeWidth="2" />
              <path d="M12 20c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#2DB08A" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="20" cy="20" r="3" fill="#FFE033" stroke="#1B2A4A" strokeWidth="1.5" />
            </svg>
            Collecta
          </Link>
          <p>你的个人资源宝库。收集、整理、发现，让每一条有价值的信息都触手可及。</p>
        </div>

        <div className="site-footer-col">
          <h4>产品</h4>
          <a href="#">浏览器插件</a>
          <a href="#">移动应用</a>
          <a href="#">桌面客户端</a>
          <a href="#">API</a>
        </div>

        <div className="site-footer-col">
          <h4>资源</h4>
          <a href="#">使用教程</a>
          <a href="#">帮助中心</a>
          <a href="#">更新日志</a>
          <a href="#">开发文档</a>
        </div>

        <div className="site-footer-col">
          <h4>关于</h4>
          <a href="#">团队</a>
          <a href="#">博客</a>
          <a href="#">联系我们</a>
          <a href="#">隐私政策</a>
        </div>
      </div>

      <div className="site-footer-bottom">
        <span>© 2026 Collecta. All rights reserved.</span>
        <span>Made with 💛 for knowledge lovers</span>
      </div>
    </footer>
  )
}
