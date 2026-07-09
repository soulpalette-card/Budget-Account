// ============================================================================
// 文件摘要（i18n.tsx）—— 中英文切换
// ----------------------------------------------------------------------------
// 提供一个超简单的多语言机制：组件里用 t('中文','English') 就地写两种文字，
// 当前语言是中文就显示前者、英文就显示后者。选择记在浏览器里（换语言不丢）。
// 用法：
//   const { t, lang, toggle } = useI18n()
//   <span>{t('账户','Account')}</span>
// ============================================================================

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Lang = 'zh' | 'en'

interface I18nValue {
  lang: Lang
  toggle: () => void
  t: (zh: string, en: string) => string
}

const Ctx = createContext<I18nValue | null>(null)

const KEY = 'unikoyo_lang'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem(KEY) as Lang) || 'zh'
    } catch {
      return 'zh'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      /* 存不了就算了，不影响使用 */
    }
  }, [lang])

  const toggle = () => setLang((l) => (l === 'zh' ? 'en' : 'zh'))
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en)

  return <Ctx.Provider value={{ lang, toggle, t }}>{children}</Ctx.Provider>
}

export function useI18n(): I18nValue {
  const c = useContext(Ctx)
  if (!c) throw new Error('useI18n 必须用在 <LanguageProvider> 里面')
  return c
}
