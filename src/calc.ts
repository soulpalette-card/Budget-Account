// ============================================================================
// 文件摘要（calc.ts）—— 全部计算逻辑都在这一个文件里
// ----------------------------------------------------------------------------
// 这是整个程序的“大脑/算账中心”。所有金额公式都写在这里，并且每条都有大白话注释。
// 界面(pages)只负责“显示”，真正怎么算钱，全看这个文件。
//
// 核心思想（也是整个项目要解决的问题）：
//   一笔突发支出【不可以】改写整个预测。所以我们分成【两条链】：
//     · 计划路径(planned)：按预定收支走，是“冻结”的理想线，不受突发影响。
//     · 实际路径(live)   ：计划路径再减去突发支出，是“真实”手里的钱。
//   突发支出由“缓冲金”吸收；缓冲金 = 提前准备好的一笔救火钱。
//
// 名词对照（怕看不懂英文变量名）：
//   opening        = 期初余额（月初手里的钱）
//   plannedIncome  = 预定收入   plannedExpense = 预定支出
//   unexpected     = 突发支出
//   bufferSetAside = 预留的缓冲金   bufferRemaining = 缓冲金还剩多少
//   plannedClosing = 计划期末（冻结的理想余额）
//   liveClosing    = 实际期末（真实余额 = 计划期末 - 突发）
// ============================================================================

import { config } from './config'
import type { Entry, Month } from './types'
import { round2, sub, sumAmounts } from './lib/money'

// 状态三档：OK(正常/绿) | Tight(吃紧/黄) | Deficit(赤字/红)
export type MonthStatus = 'OK' | 'Tight' | 'Deficit'

// 一个月算完之后，打包成这样一坨结果交给界面显示
export interface MonthResult {
  monthId: string
  label: string
  opening: number // 期初余额（实际路径用的期初）
  plannedOpening: number // 计划路径的期初（= 上月计划期末）
  plannedIncomeTotal: number // 预定收入合计
  plannedExpenseTotal: number // 预定支出合计
  unexpectedTotal: number // 突发支出合计
  bufferSetAside: number // 预留缓冲金
  bufferRemaining: number // 缓冲金余额（预留 - 突发）
  plannedClosing: number // 计划期末（冻结）
  liveClosing: number // 实际期末
  status: MonthStatus // 状态：OK / Tight / Deficit
}

// ----------------------------------------------------------------------------
// 小助手：把某个区块(zone)里“没被软删除”的金额挑出来
// excludeTentative=true 时，额外把“暂定(Tentative)”的收入也排除掉
// （这就是界面上那个“把握度筛选”开关的效果）
// ----------------------------------------------------------------------------
function amountsInZone(
  entries: Entry[],
  zone: Entry['zone'],
  excludeTentative: boolean,
): number[] {
  return entries
    .filter((e) => !e.is_deleted) // 排除软删除的行
    .filter((e) => e.zone === zone) // 只看这个区块
    .filter((e) => {
      // 只有在“收入 + 勾了筛选”时，才把暂定的踢掉
      if (excludeTentative && zone === 'income' && e.confidence === 'Tentative') {
        return false
      }
      return true
    })
    .map((e) => e.amount)
}

// ----------------------------------------------------------------------------
// 预定收入合计：把 income 区块里没删的金额加起来
// ----------------------------------------------------------------------------
export function plannedIncomeTotal(entries: Entry[], excludeTentative = false): number {
  return sumAmounts(amountsInZone(entries, 'income', excludeTentative))
}

// 预定支出合计：把 expense 区块里没删的金额加起来
export function plannedExpenseTotal(entries: Entry[]): number {
  return sumAmounts(amountsInZone(entries, 'expense', false))
}

// 突发支出合计：把 unexpected 区块里没删的金额加起来
export function unexpectedTotal(entries: Entry[]): number {
  return sumAmounts(amountsInZone(entries, 'unexpected', false))
}

// ----------------------------------------------------------------------------
// 缓冲金 = 提前留出来吸收突发的钱。两种算法（由 config.bufferMode 决定）：
//   fixed   → 固定金额，直接就是 config.bufferValue
//   percent → 预定支出的百分比，= 预定支出 × (bufferValue / 100)
// 例：预定支出 10000，bufferMode='percent'，bufferValue=10 → 缓冲金 = 1000
// ----------------------------------------------------------------------------
export function bufferSetAside(entries: Entry[]): number {
  if (config.bufferMode === 'fixed') {
    return round2(config.bufferValue)
  }
  // percent 模式
  const expense = plannedExpenseTotal(entries)
  return round2((expense * config.bufferValue) / 100)
}

// ----------------------------------------------------------------------------
// 单月核算：给一个月 + 它的所有行 + 期初，算出全部结果
//   opening        = 实际路径的期初（= 上月实际期末）
//   plannedOpening = 计划路径的期初（= 上月计划期末）
//   excludeTentative = 把握度筛选开关（勾上就排除暂定收入）
// ----------------------------------------------------------------------------
export function computeMonth(
  month: Month,
  entries: Entry[],
  opening: number,
  plannedOpening: number,
  excludeTentative = false,
): MonthResult {
  // 三个合计
  const income = plannedIncomeTotal(entries, excludeTentative)
  const expense = plannedExpenseTotal(entries)
  const unexpected = unexpectedTotal(entries)

  // 缓冲金：预留 与 剩余
  const setAside = bufferSetAside(entries)
  const remaining = sub(setAside, unexpected) // 缓冲金余额 = 预留 - 突发（可能变负）

  // 计划期末（冻结的理想线）= 计划期初 + 预定收入 - 预定支出
  //   注意：这里【不减突发】，所以突发再多也不会改写这条计划线。
  const plannedClosing = round2(plannedOpening + income - expense)

  // 实际期末 = 计划期末 - 突发支出
  //   注意公式用的是 plannedClosing（题目要求 liveClosing = plannedClosing - unexpectedTotal）。
  //   计划期初和实际期初可能不同（因为上个月突发过），但本月的“实际”是在
  //   本月计划线基础上再扣掉本月突发，这样两条链各自独立、含义清晰。
  const liveClosing = round2(plannedClosing - unexpected)

  // 判状态：
  //   实际期末 < 安全线   → Deficit 赤字(红)
  //   否则若缓冲金已透支   → Tight   吃紧(黄)
  //   否则                → OK      正常(绿)
  let status: MonthStatus
  if (liveClosing < config.safeThreshold) {
    status = 'Deficit'
  } else if (remaining < 0) {
    status = 'Tight'
  } else {
    status = 'OK'
  }

  return {
    monthId: month.id,
    label: month.label,
    opening,
    plannedOpening,
    plannedIncomeTotal: income,
    plannedExpenseTotal: expense,
    unexpectedTotal: unexpected,
    bufferSetAside: setAside,
    bufferRemaining: remaining,
    plannedClosing,
    liveClosing,
    status,
  }
}

// ----------------------------------------------------------------------------
// 多月连算（滚动预测的核心）：按顺序把每个月串起来。
//   两条链各自结转：
//     · 下个月的“计划期初”  = 上个月的 plannedClosing
//     · 下个月的“实际期初”  = 上个月的 liveClosing
//   第一个月：两条链的期初都用它自己的 opening_balance。
//
// 参数 entriesByMonth：一个字典，key=月id，value=那个月的所有行。
// ----------------------------------------------------------------------------
export function computeSeries(
  months: Month[],
  entriesByMonth: Record<string, Entry[]>,
  excludeTentative = false,
): MonthResult[] {
  const results: MonthResult[] = []

  // 上个月结转下来的两个期末，初始为 null（表示还没有上个月）
  let prevPlannedClosing: number | null = null
  let prevLiveClosing: number | null = null

  for (const month of months) {
    const entries = entriesByMonth[month.id] ?? []

    // 计划期初：有上月就用上月计划期末，否则用本月自带的期初余额
    const plannedOpening =
      prevPlannedClosing === null ? round2(month.opening_balance) : prevPlannedClosing
    // 实际期初：有上月就用上月实际期末，否则用本月自带的期初余额
    const opening =
      prevLiveClosing === null ? round2(month.opening_balance) : prevLiveClosing

    const result = computeMonth(month, entries, opening, plannedOpening, excludeTentative)
    results.push(result)

    // 把这个月的两个期末存起来，给下个月当期初用
    prevPlannedClosing = result.plannedClosing
    prevLiveClosing = result.liveClosing
  }

  return results
}

// ----------------------------------------------------------------------------
// 给状态配中文名和颜色（界面直接拿来用，省得到处写）
// ----------------------------------------------------------------------------
export function statusLabel(status: MonthStatus): string {
  if (status === 'OK') return '正常'
  if (status === 'Tight') return '吃紧'
  return '赤字'
}
