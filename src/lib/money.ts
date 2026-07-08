// ============================================================================
// 文件摘要（money.ts）
// ----------------------------------------------------------------------------
// 专门处理“钱”的小工具。为什么要单独一个文件？因为电脑算小数会出误差，
// 比如 0.1 + 0.2 在电脑里会变成 0.30000000000000004，
// 金额出现这种一长串小数会很难看也不准。
//
// 我们的办法：
//   - 每次算完钱都用 round2() 砍成两位小数（先乘 100 四舍五入再除 100）
//   - 显示时用 formatMoney() 加货币符号、千分位逗号、负数用红括号
// ============================================================================

import { config } from '../config'

// round2：把任何数字四舍五入到两位小数。
// 做法：乘 100 → 四舍五入成整数 → 再除 100。这样能避开浮点误差。
// 例：round2(976.64000000000328) => 976.64
export function round2(n: number): number {
  // Number.EPSILON 是个极小的修正量，帮忙修掉 1.005 这类边界四舍五入的老毛病
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// add / sub：两个金额相加/相减后，顺手 round2。
// 平时算钱都用这两个，就不容易攒出误差。
export function add(a: number, b: number): number {
  return round2(a + b)
}
export function sub(a: number, b: number): number {
  return round2(a - b)
}

// sumAmounts：把一串金额加起来（先各自 round2 再累加，最后再 round2）。
export function sumAmounts(amounts: number[]): number {
  let total = 0
  for (const a of amounts) {
    total = add(total, a)
  }
  return round2(total)
}

// formatMoney：把数字变成好看的字符串给人看。
//   - 加货币符号（config.currency，默认 "RM"）
//   - 加千分位逗号（1234567 => 1,234,567）
//   - 保留两位小数
//   - 负数用括号包起来，例如 -1234 => (RM 1,234.00)
//     （颜色红色由界面那边控制，这里只负责括号和数字）
export function formatMoney(n: number): string {
  const rounded = round2(n)
  const isNegative = rounded < 0
  const absolute = Math.abs(rounded)

  // toLocaleString 帮我们加千分位逗号并固定两位小数
  const body = absolute.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const withSymbol = `${config.currency} ${body}`
  // 负数：用括号包起来（会计常用写法）
  return isNegative ? `(${withSymbol})` : withSymbol
}

// isNegative：给界面判断“要不要标红色”用。
export function isNegative(n: number): boolean {
  return round2(n) < 0
}

// parseAmount：把用户输入的文字（可能带逗号、空格、货币符号）变回数字。
// 输入框里人可能打 "1,200" 或 "RM 1,200"，我们要能读懂。读不懂就当 0。
export function parseAmount(text: string): number {
  if (text === null || text === undefined) return 0
  // 只留下数字、小数点、负号，其余（逗号、货币符号、空格）全删掉
  const cleaned = String(text).replace(/[^0-9.-]/g, '')
  const num = Number(cleaned)
  if (Number.isNaN(num)) return 0
  return round2(num)
}
