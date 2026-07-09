// ============================================================================
// 文件摘要（Overview.tsx）—— 6 个月现金流总览
// ----------------------------------------------------------------------------
// 一眼看完连续 6 个月的预算/现金流。起始月可选：
//   选 2026-06 → 看 6、7、8、9、10、11
//   选 2026-08 → 看 8、9、10、11、12、次年1
// 每个月显示：期初 → 收入 / 支出 / 本月净 → 期末余额（一路累计结转）。
// 下方一条「期末余额」折线图，趋势一目了然。
//
// 这里是“大盘预测”视角：把每个月【所有】记录（规划＋意外，不管打没打勾）都算进去，
// 相当于你 Excel 里那条一路往下的 BALANCE。数据走 store.ts。
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import * as store from '../lib/store'
import type { Entry, Month } from '../types'
import { formatMoney, round2, sumAmounts } from '../lib/money'
import { friendlyError } from '../lib/errors'
import { LineChart } from '../components/LineChart'
import { iconFor } from '../lib/icons'

// "YYYY-MM" 加 n 个月
function ymAdd(label: string, n: number): string {
  const m = label.match(/^(\d{4})-(\d{2})$/)
  if (!m) return label
  let y = Number(m[1])
  let mo = Number(m[2]) - 1 + n // 转成 0~11 再加
  y += Math.floor(mo / 12)
  mo = ((mo % 12) + 12) % 12
  return `${y}-${String(mo + 1).padStart(2, '0')}`
}

interface Row {
  label: string
  opening: number
  income: number
  expense: number
  net: number
  closing: number
  exists: boolean // 这个月在数据库里有没有（没有就是还没建，显示空）
}

export function Overview() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [months, setMonths] = useState<Month[]>([])
  const [byMonth, setByMonth] = useState<Record<string, Entry[]>>({})
  const [startLabel, setStartLabel] = useState('')
  const [openLabels, setOpenLabels] = useState<Set<string>>(new Set()) // 展开了哪些月

  // 点某个月：展开/收起它的明细
  function toggleOpen(label: string) {
    setOpenLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  useEffect(() => {
    let alive = true
    async function run() {
      setLoading(true)
      setError('')
      try {
        const [ms, all] = await Promise.all([store.getMonths(), store.getAllEntries()])
        if (!alive) return
        const grouped: Record<string, Entry[]> = {}
        for (const m of ms) grouped[m.id] = []
        for (const e of all) if (grouped[e.month_id]) grouped[e.month_id].push(e)
        setMonths(ms)
        setByMonth(grouped)
      } catch (err) {
        if (alive) setError(friendlyError(err))
      } finally {
        if (alive) setLoading(false)
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [])

  // 每个已存在月份（按 label 排序）的 收入/支出/期初
  const sorted = useMemo(
    () => [...months].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    [months],
  )
  const dataByLabel = useMemo(() => {
    const map: Record<
      string,
      { income: number; expense: number; opening_balance: number }
    > = {}
    for (const m of sorted) {
      const es = (byMonth[m.id] ?? []).filter((e) => !e.is_deleted)
      map[m.label] = {
        income: sumAmounts(es.filter((e) => e.zone === 'income').map((e) => e.amount)),
        expense: sumAmounts(es.filter((e) => e.zone === 'expense').map((e) => e.amount)),
        opening_balance: round2(m.opening_balance),
      }
    }
    return map
  }, [sorted, byMonth])

  // label → 月份对象（点开明细时用它找出这个月的记录）
  const monthByLabel = useMemo(() => {
    const map: Record<string, Month> = {}
    for (const m of months) map[m.label] = m
    return map
  }, [months])
  function entriesForLabel(label: string): Entry[] {
    const m = monthByLabel[label]
    if (!m) return []
    return (byMonth[m.id] ?? []).filter((e) => !e.is_deleted)
  }

  const earliest = sorted[0]?.label ?? ''
  const latest = sorted[sorted.length - 1]?.label ?? ''

  // 起始月默认＝最早的月份
  useEffect(() => {
    if (earliest && !startLabel) setStartLabel(earliest)
  }, [earliest, startLabel])

  // 起始月可选项：从最早月份，到最后月份再往后 6 个月
  const startOptions = useMemo(() => {
    if (!earliest) return []
    const end = ymAdd(latest || earliest, 6)
    const opts: string[] = []
    let cur = earliest
    let guard = 0
    while (cur <= end && guard < 60) {
      opts.push(cur)
      cur = ymAdd(cur, 1)
      guard++
    }
    return opts
  }, [earliest, latest])

  // 从最早月份一路累计到窗口结束，算每个月的期初/期末
  const rows: Row[] = useMemo(() => {
    if (!earliest || !startLabel) return []
    const windowEnd = ymAdd(startLabel, 5)
    const runMap: Record<string, Row> = {}
    let carry: number | null = null
    let cur = earliest
    let guard = 0
    while (cur <= windowEnd && guard < 120) {
      const d = dataByLabel[cur]
      const income = d?.income ?? 0
      const expense = d?.expense ?? 0
      const opening = carry === null ? d?.opening_balance ?? 0 : carry
      const net = round2(income - expense)
      const closing = round2(opening + net)
      runMap[cur] = { label: cur, opening, income, expense, net, closing, exists: !!d }
      carry = closing
      cur = ymAdd(cur, 1)
      guard++
    }
    // 取窗口那 6 个月
    const out: Row[] = []
    let lab = startLabel
    for (let i = 0; i < 6; i++) {
      out.push(runMap[lab] ?? {
        label: lab,
        opening: carry ?? 0,
        income: 0,
        expense: 0,
        net: 0,
        closing: carry ?? 0,
        exists: false,
      })
      lab = ymAdd(lab, 1)
    }
    return out
  }, [earliest, startLabel, dataByLabel])

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">出错了：{error}</div>
  if (months.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center text-slate-600 shadow-sm">
        还没有任何月份，请先去「账户」记一笔。
      </div>
    )
  }

  const chartPoints = rows.map((r) => ({ label: r.label.slice(5) + '月', value: r.closing }))

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* 起始月选择 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-gradient-to-br from-amber-300 to-yellow-400 p-4 shadow-sm">
        <div>
          <div className="text-xs text-amber-900/80">6 个月现金流总览 · 从这个月起看 6 个月</div>
          <div className="mt-1 flex items-center gap-2">
            <select
              value={startLabel}
              onChange={(e) => setStartLabel(e.target.value)}
              className="rounded-md bg-white/50 px-2 py-1 font-bold text-amber-900 focus:outline-none"
            >
              {startOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <span className="text-sm text-amber-900/80">
              → {rows[0]?.label} ~ {rows[5]?.label}
            </span>
          </div>
        </div>
      </div>

      {/* 6 个月卡片（点标题展开该月明细） */}
      <div className="space-y-2">
        {rows.map((r) => {
          const open = openLabels.has(r.label)
          return (
            <div key={r.label} className="overflow-hidden rounded-2xl bg-white shadow-sm">
              {/* 卡片头：点一下展开/收起 */}
              <button onClick={() => toggleOpen(r.label)} className="w-full p-3 text-left">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    <span className="mr-1 text-slate-300">{open ? '▾' : '▸'}</span>
                    {r.label}
                    {!r.exists && (
                      <span className="ml-2 text-[11px] text-slate-300">（未建·暂空）</span>
                    )}
                  </span>
                  <span className="text-right">
                    <span className="mr-1 text-xs text-slate-400">结余</span>
                    <span
                      className={
                        'font-extrabold ' + (r.closing < 0 ? 'text-red-600' : 'text-slate-900')
                      }
                    >
                      {formatMoney(r.closing)}
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-500">承上结余 {formatMoney(r.opening)}</span>
                  <span className="text-emerald-600">收 +{formatMoney(r.income)}</span>
                  <span className="text-red-600">支 -{formatMoney(r.expense)}</span>
                  <span className={r.net < 0 ? 'text-red-600' : 'text-emerald-600'}>
                    净 {formatMoney(r.net)}
                  </span>
                </div>
              </button>

              {/* 展开：这个月的完整现金流明细 */}
              {open && <MonthDetailInline entries={entriesForLabel(r.label)} />}
            </div>
          )
        })}
      </div>

      {/* 期末余额折线图 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">结余走势</h3>
        <LineChart points={chartPoints} />
      </div>

      <p className="px-1 text-xs text-slate-400">
        点任意一个月可展开当月完整明细。这里把每个月【所有】记录都算进去（不分打勾），是“大盘预测”。
        想逐笔打勾、编辑，去「账户」页。
      </p>
    </div>
  )
}

// "2026-07-08" → "7月8日"
function prettyDate(d: string | null): string {
  if (!d) return '无日期'
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[2])}月${Number(m[3])}日` : d
}

// ---- 展开的当月明细（只读）：收入组 + 支出组，各带小计 ----
function MonthDetailInline({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return (
      <div className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-400">
        这个月还没有明细（去「账户」页记一笔）。
      </div>
    )
  }
  const income = entries.filter((e) => e.zone === 'income')
  const expense = entries.filter((e) => e.zone === 'expense')

  return (
    <div className="border-t border-slate-100 bg-slate-50/60">
      <DetailGroup title="收入" tone="income" items={income} />
      <DetailGroup title="支出" tone="expense" items={expense} />
    </div>
  )
}

function DetailGroup({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'income' | 'expense'
  items: Entry[]
}) {
  if (items.length === 0) return null
  const color = tone === 'income' ? 'text-emerald-600' : 'text-red-600'
  const sign = tone === 'income' ? '+' : '−'
  const subtotal = sumAmounts(items.map((e) => e.amount))
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-1.5 text-xs font-semibold text-slate-500">
        <span>{title}</span>
        <span className={color}>
          {sign}
          {formatMoney(subtotal)}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((e) => (
          <div key={e.id} className="px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-lg">{iconFor(e)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-700">
                  {e.description || '（未填说明）'}
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  {(e.category || (tone === 'income' ? '收入' : '支出')) + ' · ' + prettyDate(e.entry_date)}
                  {e.is_unexpected ? ' · 意外' : e.settled ? ' · ✅已实现' : ' · 待实现'}
                  {e.sub_items && e.sub_items.length > 0 ? ` · ${e.sub_items.length}项明细` : ''}
                </div>
              </div>
              <span className={'shrink-0 text-sm font-semibold ' + color}>
                {sign}
                {formatMoney(e.amount)}
              </span>
            </div>
            {/* 子项目明细（拆单）：缩进列出 */}
            {e.sub_items && e.sub_items.length > 0 && (
              <div className="ml-9 mt-1 space-y-0.5">
                {e.sub_items.map((s, i) => (
                  <div key={i} className="flex justify-between text-[11px] text-slate-400">
                    <span className="truncate">· {s.desc || '（未填）'}</span>
                    <span className="shrink-0">{formatMoney(s.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
