// ============================================================================
// 文件摘要（Login.tsx）—— 登录页
// ----------------------------------------------------------------------------
// 邮箱 + 密码登录。登录成功跳到总览；失败显示友好中文提示。
// 已经登录的人访问这页，直接送去总览（不用重复登录）。
// ============================================================================

import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { friendlyError } from '../lib/errors'

export function Login() {
  const { user, loading, signIn } = useAuth()
  const navigate = useNavigate()

  // 表单里的三个状态：邮箱、密码、以及“正在提交/出错了”的提示
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 已经登录了就别停在登录页，直接进总览
  if (!loading && user) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault() // 阻止表单默认刷新页面
    setError('')
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate('/') // 成功 → 去总览
    } catch (err) {
      setError(friendlyError(err)) // 失败 → 显示中文提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="登录 UNIKOYO 现金流预算">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="邮箱">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            placeholder="you@example.com"
          />
        </Field>
        <Field label="密码">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            placeholder="至少 6 位"
          />
        </Field>

        {/* 出错时显示红色提示 */}
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>

      <div className="mt-4 flex justify-between text-sm text-slate-500">
        <Link to="/register" className="hover:text-blue-600">
          还没账号？去注册
        </Link>
        <Link to="/reset" className="hover:text-blue-600">
          忘记密码？
        </Link>
      </div>
    </AuthShell>
  )
}

// ---- 下面两个是登录/注册/重设页共用的小外壳，放这里省得重复写 ----

// 居中的卡片外壳
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-bold text-slate-800">{title}</h1>
        {children}
      </div>
    </div>
  )
}

// 一个带标签的表单项
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}
