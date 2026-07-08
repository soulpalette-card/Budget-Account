// ============================================================================
// 文件摘要（AuthContext.tsx）
// ----------------------------------------------------------------------------
// “登录状态”的中央大脑。整个程序谁想知道“现在登录了没、是谁”，都问它。
// 做的事：
//   · 程序一加载，先问一次 getSession（判断之前是否已登录）
//   · 之后一直监听 onAuthChange（登录/登出时自动更新）
//   · 对外提供：{ user, loading, signIn, signUp, signOut }
// 组件用法：const { user, signIn } = useAuth()
//
// 注意：这里调用的 signIn/signUp/signOut 都是走 store.ts 的，不直接碰 supabase。
// ============================================================================

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as store from '../lib/store'

// “用户”长这样（我们只关心 id 和邮箱）
interface AuthUser {
  id: string
  email: string
}

// Context 对外提供的东西
interface AuthContextValue {
  user: AuthUser | null // 当前用户；null 表示没登录
  loading: boolean // 是否还在“确认登录状态”中（一开始为 true）
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

// 创建 Context（初始给 null，下面 Provider 会填真值）
const AuthContext = createContext<AuthContextValue | null>(null)

// Provider：把它包在整个 App 外面，里面的组件才能用 useAuth()
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true) // 一开始还没确认，先 true

  useEffect(() => {
    let unsub: (() => void) | undefined

    // 1) 先问一次现在的会话
    store
      .getSession()
      .then((session) => {
        if (session?.user) {
          setUser({ id: session.user.id, email: session.user.email ?? '' })
        }
      })
      .catch(() => {
        // 拿会话失败就当没登录，不用吓用户
      })
      .finally(() => {
        setLoading(false) // 不管结果如何，确认完毕
      })

    // 2) 之后持续监听登录状态变化
    unsub = store.onAuthChange((email, id) => {
      if (id && email) {
        setUser({ id, email })
      } else {
        setUser(null)
      }
    })

    // 组件卸载时取消监听
    return () => {
      if (unsub) unsub()
    }
  }, [])

  // 包一层：登录成功后顺手更新 user（监听器一般也会触发，这里双保险）
  const signIn = async (email: string, password: string) => {
    await store.signIn(email, password)
  }
  const signUp = async (email: string, password: string) => {
    await store.signUp(email, password)
  }
  const signOut = async () => {
    await store.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// useAuth：组件里拿登录信息的快捷方式。忘了包 Provider 会报错提醒。
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须用在 <AuthProvider> 里面')
  return ctx
}
