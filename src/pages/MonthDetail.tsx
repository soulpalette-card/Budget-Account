// ============================================================================
// 文件摘要（MonthDetail.tsx）—— 每月明细页
// ----------------------------------------------------------------------------
// 选一个月，下面三个【明显分开】的区块：
//   区块1 预定收入（每行带把握度下拉）
//   区块2 预定支出（每行带分类下拉）
//   区块3 突发 🔺（红色标题，视觉突出）
// 顶部有一张“本月核算卡”，实时显示期初/计划期末/实际期末/缓冲余额/状态。
//
// 数据走 store.ts；计算走 calc.ts（整条链算完取本月，保证期初结转正确）。
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import * as store from '../lib/store'
import type { Entry, Month } from '../types'
import { computeSeries, statusLabel, type MonthResult } from '../calc'
import { EntryTable } from '../components/EntryTable'
import { Money } from '../components/Money'
import { friendlyError } from '../lib/errors'

export function MonthDetail() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [months, setMonths] = useState<Month[]>([])
  const [entriesByMonth, setEntriesByMonth] = useState<Record<string, Entry[]>>({})
  const [selectedId, setSelectedId] = useState<string>('') // 当前选中的月

  // 加载所有月份 + 所有记录（算链需要全部数据）
  async function load() {
    setLoading(true)
    setError('')
    try {
      const [ms, allEntries] = await Promise.all([store.getMonths(), store.getAllEntries()])
      const grouped: Record<string, Entry[]> = {}
      for (const m of ms) grouped[m.id] = []
      for (const e of allEntries) {
        if (grouped[e.month_id]) grouped[e.month_id].push(e)
      }
      setMonths(ms)
      setEntriesByMonth(grouped)
      // 默认选中：保持原选择，没有就选第一个
      setSelectedId((prev) => (prev && ms.some((m) => m.id === prev) ? prev : ms[0]?.id ?? ''))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 算整条链
  const series: MonthResult[] = useMemo(
    () => computeSeries(months, entriesByMonth),
    [months, entriesByMonth],
  )

  // 当前选中月的核算结果
  const current = series.find((r) => r.monthId === selectedId)
  // 当前选中月的所有记录
  const currentEntries = entriesByMonth[selectedId] ?? []
  const incomeEntries = currentEntries.filter((e) => e.zone === 'income')
  const expenseEntries = currentEntries.filter((e) => e.zone === 'expense')
  const unexpectedEntries = currentEntries.filter((e) => e.zone === 'unexpected')

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">出错了：{error}</div>
  if (months.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-slate-600 shadow-sm">
        还没有任何月份，请先去「设置」新增一个月。
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 顶部：选月份 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-slate-800">每月明细</h2>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 focus:border-blue-500 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* 本月核算卡：一眼看懂这个月的健康状况 */}
      {current && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="期初余额" value={current.opening} />
          <StatCard label="预留缓冲" value={current.bufferSetAside} />
          <StatCard label="缓冲余额" value={current.bufferRemaining} />
          <StatCard label="计划期末（冻结）" value={current.plannedClosing} bold />
          <StatCard label="实际期末" value={current.liveClosing} bold />
          <div className="rounded-lg bg-white p-3 shadow-sm">
            <div className="text-xs text-slate-500">状态</div>
            <div
              className={
                'mt-1 inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ' +
                (current.status === 'OK'
                  ? 'bg-green-100 text-green-700'
                  : current.status === 'Tight'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-red-100 text-red-700')
              }
            >
              {statusLabel(current.status)}
            </div>
          </div>
        </div>
      )}

      {/* 区块1：预定收入 */}
      <ZoneCard title="① 预定收入" hint="这些是计划中的进账。把握度不同可在总览里做筛选。">
        <EntryTable
          zone="income"
          monthId={selectedId}
          entries={incomeEntries}
          onChanged={load}
          onError={(m) => setError(m)}
        />
      </ZoneCard>

      {/* 区块2：预定支出 */}
      <ZoneCard title="② 预定支出" hint="这些是计划中的开销，构成“冻结”的计划期末。">
        <EntryTable
          zone="expense"
          monthId={selectedId}
          entries={expenseEntries}
          onChanged={load}
          onError={(m) => setError(m)}
        />
      </ZoneCard>

      {/* 区块3：突发支出（红色突出） */}
      <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 shadow-sm">
        <h3 className="mb-1 text-lg font-bold text-red-600">🔺 突发支出</h3>
        <p className="mb-3 text-xs text-red-500">
          没计划到的开销放这里。它只吃“缓冲金”、只影响“实际期末”，
          【不会】改动上面那条冻结的计划期末。
        </p>
        <EntryTable
          zone="unexpected"
          monthId={selectedId}
          entries={unexpectedEntries}
          onChanged={load}
          onError={(m) => setError(m)}
        />
      </div>
    </div>
  )
}

// 顶部小卡片：显示一个金额指标
function StatCard({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-sm">
        <Money value={value} bold={bold} />
      </div>
    </div>
  )
}

// 区块外壳（收入/支出用）
function ZoneCard({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <h3 className="mb-1 text-lg font-bold text-slate-800">{title}</h3>
      <p className="mb-3 text-xs text-slate-400">{hint}</p>
      {children}
    </div>
  )
}
