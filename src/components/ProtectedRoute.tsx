// ============================================================================
// 文件摘要（ProtectedRoute.tsx）
// ----------------------------------------------------------------------------
// “门卫”组件。把需要登录才能看的页面包在它里面：
//   · 还在确认登录状态 → 显示“加载中”
//   · 没登录          → 自动跳去 /login
//   · 已登录          → 正常显示里面的页面
// ============================================================================

import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  // 还没确认完登录状态，先显示加载，别急着跳转（不然刷新页面会被误踢出去）
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        正在确认登录状态…
      </div>
    )
  }

  // 确认完了还是没登录 → 跳去登录页
  if (!user) {
    return <Navigate to="/login" replace />
  }

  // 已登录 → 放行
  return <>{children}</>
}
