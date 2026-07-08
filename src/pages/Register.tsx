// ============================================================================
// 文件摘要（Register.tsx）—— 注册页
// ----------------------------------------------------------------------------
// 邮箱 + 密码注册。注册成功后：
//   · 如果 Supabase 设置了“需要邮箱验证”，提示去邮箱点确认链接；
//   · 否则可能直接就登录了，跳去总览。
// ============================================================================

import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { friendlyError } from '../lib/errors'
import { AuthShell, Field } from './Login'

export function Register() {
  const { user, loading, signUp } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('') // 再输一次，防手滑
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('') // 成功提示（比如“去邮箱验证”）

  // 已登录就别停在注册页
  if (!loading && user) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setOkMsg('')

    // 前端先做两个简单检查，体验更好
    if (password.length < 6) {
      setError('密码至少要 6 位。')
      return
    }
    if (password !== password2) {
      setError('两次输入的密码不一样，请重新输。')
      return
    }

    setSubmitting(true)
    try {
      await signUp(email.trim(), password)
      // 注册成功。如果需要邮箱验证，onAuthChange 不会立刻给到 user，
      // 这时给个提示；如果直接登录了，下面的 Navigate 会自动跳走。
      setOkMsg('注册成功！如果收到验证邮件，请去邮箱点确认链接后再登录。')
      // 稍等一下让用户看到提示，再尝试进总览（若已登录）
      setTimeout(() => navigate('/'), 1500)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="注册新账号">
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
        <Field label="再输一次密码">
          <input
            type="password"
            required
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            placeholder="确认密码"
          />
        </Field>

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {okMsg && (
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{okMsg}</div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? '注册中…' : '注册'}
        </button>
      </form>

      <div className="mt-4 text-center text-sm text-slate-500">
        <Link to="/login" className="hover:text-blue-600">
          已有账号？去登录
        </Link>
      </div>
    </AuthShell>
  )
}
