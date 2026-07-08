// ============================================================================
// 文件摘要（Money.tsx）
// ----------------------------------------------------------------------------
// 一个专门显示金额的小组件。好处：负数自动变红色括号，正数正常显示，
// 全程序显示钱的地方都用它，风格统一。
//   用法：<Money value={1234.5} />        → RM 1,234.50
//        <Money value={-1234} />          → 红色 (RM 1,234.00)
// ============================================================================

import { formatMoney, isNegative } from '../lib/money'

export function Money({ value, bold = false }: { value: number; bold?: boolean }) {
  const negative = isNegative(value)
  return (
    <span
      className={
        (negative ? 'text-red-600' : 'text-slate-800') + (bold ? ' font-semibold' : '')
      }
    >
      {formatMoney(value)}
    </span>
  )
}
