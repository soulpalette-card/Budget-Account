// ============================================================================
// 文件摘要（errors.ts）
// ----------------------------------------------------------------------------
// 把 Supabase 返回的英文错误，翻成友好的大白话中文提示给用户看。
// 找不到对应的就原样显示，至少不会一片空白。
// ============================================================================

export function friendlyError(err: unknown): string {
  // 先把错误里的文字抠出来
  const raw =
    (err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)) || '未知错误'

  const lower = raw.toLowerCase()

  // 常见登录/注册错误的中文对照
  if (lower.includes('invalid login credentials')) {
    return '邮箱或密码不对，请再检查一下。'
  }
  if (lower.includes('email not confirmed')) {
    return '邮箱还没验证，请去邮箱点确认链接后再登录。'
  }
  if (lower.includes('user already registered')) {
    return '这个邮箱已经注册过了，直接去登录吧。'
  }
  if (lower.includes('password should be at least')) {
    return '密码太短了，至少要 6 位。'
  }
  if (lower.includes('unable to validate email address') || lower.includes('invalid email')) {
    return '邮箱格式不对，请检查。'
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return '操作太频繁了，请等一会儿再试。'
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return '网络连不上，请检查网络或稍后再试。'
  }
  if (lower.includes('不许') || lower.includes('还没登录') || lower.includes('没找到')) {
    // 我们自己抛的中文错误，原样返回
    return raw
  }

  // 兜底：原样显示
  return raw
}
