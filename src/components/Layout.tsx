// ============================================================================
// 文件摘要（Layout.tsx）
// ----------------------------------------------------------------------------
// 所有登录后页面的“外框”：顶部一条导航栏（总览/每月明细/设置 + 登出），
// 下面用 <Outlet/> 显示当前页面内容。
// ============================================================================

import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  // 点“登出”：登出后回到登录页
  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // 导航链接的样式：选中的高亮，没选中的灰色
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    'px-3 py-2 rounded-md text-sm font-medium ' +
    (isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200')

  return (
    <div className="min-h-screen">
      {/* 顶部导航栏 */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-lg font-bold text-slate-800">UNIKOYO 现金流预算</span>
            <nav className="flex gap-1">
              <NavLink to="/" end className={linkClass}>
                账户
              </NavLink>
              <NavLink to="/settings" className={linkClass}>
                设置
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {/* 显示当前登录的邮箱 */}
            <span className="hidden text-sm text-slate-500 sm:inline">{user?.email}</span>
            <button
              onClick={handleSignOut}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      {/* 页面主体：当前路由的页面会显示在这里 */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
