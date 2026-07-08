// ============================================================================
// 文件摘要（supabase.ts）
// ----------------------------------------------------------------------------
// 这里只做一件事：用环境变量创建一个“连上你 Supabase 云端”的客户端对象。
// 别的文件（主要是 store.ts）会拿这个对象去读写数据、做登录。
//
// 安全铁律：
//   · URL 和钥匙都从 .env 环境变量里读，【绝不】写死在代码里。
//   · 只用 anon（公开）钥匙。【绝不】在前端用 service_role 钥匙（它会绕过 RLS）。
// ============================================================================

import { createClient } from '@supabase/supabase-js'

// 从环境变量里读地址和公开钥匙（值在 .env 文件里，样板见 .env.example）
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 防呆检查：如果没填环境变量，早点报错提醒，别等到用的时候一头雾水
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '❌ 没找到 Supabase 环境变量！请把 .env.example 复制成 .env，' +
      '并填上 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY（见 README）。',
  )
}

// 创建并导出客户端。整个程序只需要这一个，别的地方 import 它就行。
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
