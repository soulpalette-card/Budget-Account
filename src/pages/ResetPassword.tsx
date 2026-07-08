// ============================================================================
// 文件摘要（ResetPassword.tsx）—— 重设密码页（可选功能）
// ----------------------------------------------------------------------------
// 输入邮箱，Supabase 会发一封“重设密码”邮件。用户点邮件里的链接去改密码。
// ============================================================================

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as store from '../lib/store'
import { friendlyError } from '../lib/errors'
import { AuthShell, Field } from './Login'

export function ResetPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setOkMsg('')
    setSubmitting(true)
    try {
      await store.resetPassword(email.trim())
      setOkMsg('已发送重设密码邮件，请去邮箱查收并点链接。')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="重设密码">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="注册时用的邮箱">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            placeholder="you@example.com"
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
          {submitting ? '发送中…' : '发送重设邮件'}
        </button>
      </form>

      <div className="mt-4 text-center text-sm text-slate-500">
        <Link to="/login" className="hover:text-blue-600">
          想起来了？回登录
        </Link>
      </div>
    </AuthShell>
  )
}
