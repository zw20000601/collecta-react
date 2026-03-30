# Collecta React (Vite)

## 1) 运行

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
npm run preview
```

如果你本机没有全局 Node，可直接用便携脚本：

- `F:\collecta-react\start-dev.cmd`
- `F:\collecta-react\build.cmd`

## 1.1) 一键上线（Vercel）

1. 把项目推送到 GitHub（`collecta-react` 仓库）。
2. 打开 [Vercel](https://vercel.com/) 并登录，点击 `Add New Project`。
3. 选择你的 GitHub 仓库并导入。
4. 构建设置保持默认：
   - `Framework Preset`: `Vite`
   - `Build Command`: `npm run build`
   - `Output Directory`: `dist`
5. 在 `Environment Variables` 添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ADMIN_EMAIL`
6. 点击 `Deploy`，完成后会得到线上链接（`https://xxx.vercel.app`）。

备注：

- 本项目已包含 `vercel.json`，支持 React Router 路由直达和刷新（如 `/admin/resources`）。
- 以后每次推送到 GitHub，Vercel 会自动重新部署，不需要再手动命令行启动。

## 2) 环境变量

复制 `.env.example` 为 `.env.local` 并按需修改：

```bash
VITE_SUPABASE_URL=https://gylkqocldmahurvklkcs.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_8whEur7VAJhVYFQoDcOkFw_m1oiofyX
VITE_ADMIN_EMAIL=1781586305@qq.com
```

## 3) 核心能力

- React Router 页面拆分：`/ /categories /favorites /messages /login /admin`
- 收藏、留言、资源管理（添加/编辑/删除）
- 游客模式（`sessionStorage.isGuest`）
- 管理员后台（邮箱守卫）
- 全局错误边界（ErrorBoundary）
- 全局操作提示（Toast）

## 4) 目录

```text
src/
  lib/
    supabase.js
    resourceUtils.js
    notify.js
  pages/
    Home.jsx
    Categories.jsx
    Favorites.jsx
    Messages.jsx
    Login.jsx
    Admin.jsx
  components/
    Navbar.jsx
    ResourceCard.jsx
    HeroClouds.jsx
    ToastHost.jsx
    ErrorBoundary.jsx
```

## 5) SQL

Supabase 建表与 RLS：见 `supabase.sql`。
