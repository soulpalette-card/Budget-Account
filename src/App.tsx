// ============================================================================
// 文件摘要（App.tsx）—— 路由总调度
// ----------------------------------------------------------------------------
// 决定“输入什么网址，显示哪个页面”，并用 AuthProvider 把登录状态包在最外层。
// 路由分两类：
//   公开页（不用登录）：/login 登录、/register 注册、/reset 重设密码
//   受保护页（要登录，被 ProtectedRoute 和 Layout 包着）：
//     /          总览
//     /month     每月明细
//     /settings  设置
// ============================================================================

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LanguageProvider } from './lib/i18n'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { ResetPassword } from './pages/ResetPassword'
import { Account } from './pages/Account'
import { Overview } from './pages/Overview'
import { Certificate } from './pages/Certificate'
import { MonthDetail } from './pages/MonthDetail'
import { Settings } from './pages/Settings'

export default function App() {
  return (
    <LanguageProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ===== 公开页：不用登录也能看 ===== */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/reset" element={<ResetPassword />} />

          {/* ===== 受保护页：必须登录。外面套 ProtectedRoute + Layout ===== */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* 首页 = 简单账本（默认看到的就是它） */}
            <Route path="/" element={<Account />} />
            {/* 下面几个是“高级”页面，不放主导航，从设置里进 */}
            <Route path="/overview" element={<Overview />} />
            <Route path="/certificate" element={<Certificate />} />
            <Route path="/month" element={<MonthDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* 其它乱输的网址，一律送回总览 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </LanguageProvider>
  )
}
