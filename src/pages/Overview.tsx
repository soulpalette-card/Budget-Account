// ============================================================================
// 文件摘要（Overview.tsx）—— 总览页
// ----------------------------------------------------------------------------
// 把“当前月 + 之后 5 个月”一共 6 个月并排显示，每行一个指标，全自动算：
//   期初余额 | 预定收入 | 预定支出 | 预留缓冲 | 突发支出 | 缓冲余额 |
//   计划期末(冻结) | 实际期末 | 状态(绿OK/黄吃紧/红赤字)
// 下方画“实际期末”这 6 个月的小折线图。
// 有一个“把握度筛选”开关：勾上后把暂定收入从实际余额里排除。
//
// 数据全走 store.ts；计算全走 calc.ts；本页只负责显示 + 加载/错误状态。
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as store from '../lib/store'
import type { Entry, Month } from '../types'
import { computeSeries, statusLabel, type MonthResult, type MonthStatus } from '../calc'
import { Money } from '../components/Money'
import { LineChart } from '../components/LineChart'
import { friendlyError } from '../lib/errors'

// 找“当前月”的下标：优先找 label 里含今天年月(YYYY-MM)的那个月，找不到就从头开始。
function findStartIndex(months: Month[]): number {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const idx = months.findIndex((m) => m.label.includes(ym))
  return idx >= 0 ? idx : 0
}

// 状态对应的颜色小圆点样式
function statusChip(status: MonthStatus) {
  const map: Record<MonthStatus, string> = {
    OK: 'bg-green-100 text-green-700',
    Tight: 'bg-yellow-100 text-yellow-700',
    Deficit: 'bg-red-100 text-red-700',
  }
  return map[status]
}

export function Overview() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [months, setMonths] = useState<Month[]>([])
  const [entriesByMonth, setEntriesByMonth] = useState<Record<string, Entry[]>>({})
  const [excludeTentative, setExcludeTentative] = useState(false) // 把握度筛选开关

  // 加载数据：一次性把所有月份 + 所有记录拿回来
  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [ms, allEntries] = await Promise.all([store.getMonths(), store.getAllEntries()])
        if (!alive) return
        // 把记录按月分组
        const grouped: Record<string, Entry[]> = {}
        for (const m of ms) grouped[m.id] = []
        for (const e of allEntries) {
          if (grouped[e.month_id]) grouped[e.month_id].push(e)
        }
        setMonths(ms)
        setEntriesByMonth(grouped)
      } catch (err) {
        if (alive) setError(friendlyError(err))
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [])

  // 算整条链（用 useMemo 缓存，数据没变就不重算）
  const series: MonthResult[] = useMemo(
    () => computeSeries(months, entriesByMonth, excludeTentative),
    [months, entriesByMonth, excludeTentative],
  )

  // 滚动窗口：从“当前月”开始取 6 个月
  const startIndex = useMemo(() => findStartIndex(months), [months])
  const windowResults = useMemo(
    () => series.slice(startIndex, startIndex + 6),
    [series, startIndex],
  )

  // 折线图的点：这 6 个月的“实际期末”
  const chartPoints = windowResults.map((r) => ({ label: r.label, value: r.liveClosing }))

  // ---- 各种界面状态 ----
  if (loading) {
    return <div className="py-16 text-center text-slate-500">加载中…</div>
  }
  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700">
        出错了：{error}
      </div>
    )
  }
  if (months.length === 0) {
    // 一个月都还没有 → 引导去设置/明细创建
    return (
      <div className="rounded-xl bg-white p-8 text-center shadow-sm">
        <p className="mb-4 text-slate-600">还没有任何月份数据。</p>
        <Link
          to="/settings"
          className="inline-block rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          去设置里新增第一个月
        </Link>
      </div>
    )
  }

  // 表格左边一列的“行名”
  const rows: { key: keyof MonthResult; label: string; kind?: 'money' | 'status' }[] = [
    { key: 'opening', label: '期初余额', kind: 'money' },
    { key: 'plannedIncomeTotal', label: '预定收入', kind: 'money' },
    { key: 'plannedExpenseTotal', label: '预定支出', kind: 'money' },
    { key: 'bufferSetAside', label: '预留缓冲', kind: 'money' },
    { key: 'unexpectedTotal', label: '突发支出', kind: 'money' },
    { key: 'bufferRemaining', label: '缓冲余额', kind: 'money' },
    { key: 'plannedClosing', label: '计划期末（冻结）', kind: 'money' },
    { key: 'liveClosing', label: '实际期末', kind: 'money' },
    { key: 'status', label: '状态', kind: 'status' },
  ]

  return (
    <div className="space-y-6">
      {/* 顶部：标题 + 把握度筛选开关 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">总览（当前月 + 之后 5 个月）</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={excludeTentative}
            onChange={(e) => setExcludeTentative(e.target.checked)}
          />
          只算有把握的收入（排除“暂定”）
        </label>
      </div>

      {/* 6 个月并排的表格 */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="sticky left-0 bg-white px-4 py-3 text-left font-medium text-slate-500">
                指标 \ 月份
              </th>
              {windowResults.map((r) => (
                <th key={r.monthId} className="px-4 py-3 text-right font-semibold text-slate-700">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 bg-white px-4 py-2.5 text-left font-medium text-slate-500">
                  {row.label}
                </td>
                {windowResults.map((r) => (
                  <td key={r.monthId} className="px-4 py-2.5 text-right">
                    {row.kind === 'status' ? (
                      <span
                        className={
                          'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                          statusChip(r.status)
                        }
                      >
                        {statusLabel(r.status)}
                      </span>
                    ) : (
                      <Money
                        value={r[row.key] as number}
                        bold={row.key === 'liveClosing' || row.key === 'plannedClosing'}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 折线图：实际期末走势 */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="mb-2 font-semibold text-slate-700">实际期末走势</h3>
        <LineChart points={chartPoints} />
      </div>

      {/* 小提示 */}
      <p className="text-xs text-slate-400">
        提示：突发支出只影响“实际期末”，不会改动“计划期末（冻结）”。缓冲余额变负说明救火钱不够了。
      </p>
    </div>
  )
}
