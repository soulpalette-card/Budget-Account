// ============================================================================
// 文件摘要（Account.tsx）—— 首页「账户」（简单账本，带累计）
// ----------------------------------------------------------------------------
// 登录后看到的第一个页面，做得尽量简单好用：
//   · 顶部四个大数字：收入、支出、本月净、累计余额（自动算）
//   · 一张表格：日期 | 说明 | 分类 | 收入 | 支出 | 操作
//     点格子直接填/改，鼠标一离开自动保存
//   · 每一行有「复制到下月」按钮：一键把这笔复制到下一个月（只复制一个月）
//   · 底部「快速添加」一行：填好按回车或点＋添加就多一行
//   · 右上「🖨 列印」：按 A4 纸排版打印
//
// 【累计】：每个账户（月份）的期初 = 上一个月的余额，一路滚动累加。
//          只有第一个月的期初余额需要你手填，后面的都自动结转。
//
// 数据走 store.ts；一个账户 = 数据库里的一个“月份”。
// ============================================================================

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import * as store from '../lib/store'
import type { Entry, Month } from '../types'
import { config } from '../config'
import { formatMoney, parseAmount, round2, sumAmounts } from '../lib/money'
import { friendlyError } from '../lib/errors'

// 当前年月，例如 "2026-07"
function currentYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 根据一个 "YYYY-MM" 算出下一个月的名字；不是这种格式就退而求其次
function nextLabel(label: string): string {
  const m = label.match(/^(\d{4})-(\d{2})$/)
  if (m) {
    let y = Number(m[1])
    let mo = Number(m[2]) + 1
    if (mo > 12) {
      mo = 1
      y++
    }
    return `${y}-${String(mo).padStart(2, '0')}`
  }
  return label + '-下月'
}

// 一个月算出来的汇总
interface MonthCalc {
  opening: number // 期初（第一个月=手填，其它=上月余额结转）
  income: number // 本月收入
  expense: number // 本月支出（含突发）
  net: number // 本月净 = 收入 − 支出
  closing: number // 累计余额 = 期初 + 净
}

// 把所有月份按顺序滚一遍，算出每个月的累计余额
function computeRunning(
  months: Month[],
  byMonth: Record<string, Entry[]>,
): Record<string, MonthCalc> {
  const result: Record<string, MonthCalc> = {}
  let carry: number | null = null // 上个月结转下来的余额

  for (const m of months) {
    const es = byMonth[m.id] ?? []
    const income = sumAmounts(es.filter((e) => e.zone === 'income').map((e) => e.amount))
    const expense = sumAmounts(
      es.filter((e) => e.zone === 'expense' || e.zone === 'unexpected').map((e) => e.amount),
    )
    // 第一个月用它自己填的期初；之后的月用上月结转
    const opening = carry === null ? round2(m.opening_balance) : carry
    const net = round2(income - expense)
    const closing = round2(opening + net)
    result[m.id] = { opening, income, expense, net, closing }
    carry = closing // 传给下个月
  }
  return result
}

export function Account() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('') // 临时提示（比如“已复制到 xxx”）
  const [months, setMonths] = useState<Month[]>([])
  const [byMonth, setByMonth] = useState<Record<string, Entry[]>>({})
  const [selectedId, setSelectedId] = useState('')

  // 加载：拿所有月份 + 所有记录；没有月份就自动建一个当月账户
  async function load(keepId?: string) {
    setLoading(true)
    setError('')
    try {
      let ms = await store.getMonths()
      if (ms.length === 0) {
        await store.addMonth({ label: currentYm(), opening_balance: 0 })
        ms = await store.getMonths()
      }
      const all = await store.getAllEntries()
      const grouped: Record<string, Entry[]> = {}
      for (const m of ms) grouped[m.id] = []
      for (const e of all) if (grouped[e.month_id]) grouped[e.month_id].push(e)

      setMonths(ms)
      setByMonth(grouped)
      const pick = keepId && ms.some((m) => m.id === keepId) ? keepId : ms[0].id
      setSelectedId((prev) => (prev && ms.some((m) => m.id === prev) ? prev : pick))
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

  // 算每个月的累计
  const calcMap = useMemo(() => computeRunning(months, byMonth), [months, byMonth])

  const currentMonth = months.find((m) => m.id === selectedId)
  const isFirstMonth = months.length > 0 && months[0].id === selectedId
  const entries = byMonth[selectedId] ?? []
  const calc = calcMap[selectedId] ?? { opening: 0, income: 0, expense: 0, net: 0, closing: 0 }

  // ---- 各种操作，改完都重新加载（保持选中当前账户）----
  async function saveField(entry: Entry, patch: Partial<Entry>) {
    try {
      await store.saveEntry({
        id: entry.id,
        month_id: entry.month_id,
        zone: entry.zone,
        entry_date: patch.entry_date !== undefined ? patch.entry_date : entry.entry_date,
        amount: patch.amount !== undefined ? patch.amount : entry.amount,
        category: patch.category !== undefined ? patch.category : entry.category,
        description: patch.description !== undefined ? patch.description : entry.description,
        confidence: entry.confidence,
        settled: entry.settled,
        note: entry.note,
      })
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function removeRow(id: string) {
    try {
      await store.deleteEntry(id)
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function saveOpening(value: number) {
    if (!currentMonth) return
    try {
      await store.updateMonth(currentMonth.id, { opening_balance: value })
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  // 复制某一行到“下一个月”。下个月不存在就自动新建一个。（一次只复制一个月）
  async function copyToNext(entry: Entry) {
    setMsg('')
    setError('')
    try {
      const idx = months.findIndex((m) => m.id === entry.month_id)
      let target = months[idx + 1] // 下一个月

      // 没有下个月 → 自动建一个
      if (!target) {
        const label = nextLabel(months[idx].label)
        target = await store.addMonth({ label, opening_balance: 0 })
      }

      // 把这笔复制过去（新的一条，不动原来的）
      await store.saveEntry({
        month_id: target.id,
        zone: entry.zone,
        entry_date: entry.entry_date,
        amount: entry.amount,
        category: entry.category,
        description: entry.description,
        confidence: entry.confidence,
        note: entry.note,
      })
      setMsg(`已把「${entry.description ?? '这笔'}」复制到下个月「${target.label}」。`)
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>

  return (
    <div className="space-y-5">
      {/* 打印专用标题（平时隐藏，打印时才出现） */}
      <div className="print-only mb-2">
        <h1 className="text-lg font-bold">UNIKOYO 账本 — {currentMonth?.label}</h1>
      </div>

      {/* 顶部工具行：账户选择 + 期初 + 列印按钮（列印时隐藏这一整行） */}
      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1 text-xs text-slate-500">账户（月份）</div>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              {months.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* 期初：只有第一个月能手填，其它月自动结转（只读显示） */}
          <div>
            <div className="mb-1 text-xs text-slate-500">
              {isFirstMonth ? '期初余额（第一个月，手动填）' : '期初（上月结转，自动）'}
            </div>
            {isFirstMonth ? (
              <input
                type="text"
                inputMode="decimal"
                key={selectedId + '-' + calc.opening}
                defaultValue={calc.opening.toFixed(2)}
                onBlur={(e) => {
                  const v = parseAmount(e.target.value)
                  e.target.value = v.toFixed(2)
                  if (v !== calc.opening) saveOpening(v)
                }}
                className="w-40 rounded-md border border-slate-300 px-3 py-2 text-right focus:border-blue-500 focus:outline-none"
              />
            ) : (
              <div className="w-40 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-right text-slate-600">
                {formatMoney(calc.opening)}
              </div>
            )}
          </div>
        </div>

        {/* 列印按钮 */}
        <button
          onClick={() => window.print()}
          className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100"
        >
          🖨 列印（A4）
        </button>
      </div>

      {error && (
        <div className="no-print rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {msg && (
        <div className="no-print rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>
      )}

      {/* 四个大数字：收入 / 支出 / 本月净 / 累计余额 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BigStat label="收入" value={calc.income} tone="income" />
        <BigStat label="支出" value={calc.expense} tone="expense" />
        <BigStat label="本月净" value={calc.net} tone="net" />
        <BigStat label="累计余额" value={calc.closing} tone="remaining" />
      </div>

      {/* 账本表格 */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2.5">日期</th>
              <th className="px-3 py-2.5">说明</th>
              <th className="px-3 py-2.5">分类</th>
              <th className="px-3 py-2.5 text-right text-green-700">收入</th>
              <th className="px-3 py-2.5 text-right text-red-600">支出</th>
              <th className="no-print px-3 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  还没有记录，在下面那行直接填就行 👇
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const isIncome = e.zone === 'income'
              return (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                  {/* 日期 */}
                  <td className="px-3 py-1.5">
                    <input
                      type="date"
                      defaultValue={e.entry_date ?? ''}
                      onBlur={(ev) => {
                        const v = ev.target.value || null
                        if (v !== e.entry_date) saveField(e, { entry_date: v })
                      }}
                      className="w-36 rounded border border-transparent px-1 py-1 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  {/* 说明 */}
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      defaultValue={e.description ?? ''}
                      placeholder="点这里写说明…"
                      onBlur={(ev) => {
                        const v = ev.target.value || null
                        if (v !== e.description) saveField(e, { description: v })
                      }}
                      className="w-full min-w-[130px] rounded border border-transparent px-1 py-1 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  {/* 分类 */}
                  <td className="px-3 py-1.5">
                    <select
                      defaultValue={e.category ?? ''}
                      onChange={(ev) => saveField(e, { category: ev.target.value || null })}
                      className="rounded border border-slate-200 px-1 py-1 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">（未分类）</option>
                      {config.categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  {/* 收入列 */}
                  <td className="px-3 py-1.5 text-right">
                    {isIncome ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={e.amount.toFixed(2)}
                        onBlur={(ev) => {
                          const v = parseAmount(ev.target.value)
                          ev.target.value = v.toFixed(2)
                          if (v !== e.amount) saveField(e, { amount: v })
                        }}
                        className="w-24 rounded border border-transparent px-1 py-1 text-right text-green-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  {/* 支出列 */}
                  <td className="px-3 py-1.5 text-right">
                    {!isIncome ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={e.amount.toFixed(2)}
                        onBlur={(ev) => {
                          const v = parseAmount(ev.target.value)
                          ev.target.value = v.toFixed(2)
                          if (v !== e.amount) saveField(e, { amount: v })
                        }}
                        className="w-24 rounded border border-transparent px-1 py-1 text-right text-red-600 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  {/* 操作：复制到下月 + 删（列印时不显示） */}
                  <td className="no-print px-3 py-1.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => copyToNext(e)}
                      className="mr-3 text-xs text-blue-600 hover:text-blue-800"
                      title="把这一笔复制到下一个月"
                    >
                      复制到下月
                    </button>
                    <button
                      onClick={() => removeRow(e.id)}
                      className="text-xs text-slate-400 hover:text-red-600"
                      title="删除这一行（可在设置里恢复）"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* 快速添加一行（列印时隐藏） */}
        <div className="no-print">
          <QuickAdd monthId={selectedId} onAdded={() => load(selectedId)} onError={setError} />
        </div>
      </div>

      <p className="no-print text-xs text-slate-400">
        小提示：收入填「收入」列、支出填「支出」列，累计余额会自动往下个月结转。
        「复制到下月」一次只复制到紧接着的那一个月。删掉的行可在「设置」里恢复。
      </p>
    </div>
  )
}

// ---- 顶部大数字卡片 ----
function BigStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'income' | 'expense' | 'net' | 'remaining'
}) {
  // 颜色：收入绿、支出红、净额和余额看正负（正蓝/绿、负红）
  let color = 'text-blue-600'
  if (tone === 'income') color = 'text-green-600'
  else if (tone === 'expense') color = 'text-red-600'
  else if (tone === 'net') color = value < 0 ? 'text-red-600' : 'text-green-600'
  else color = value < 0 ? 'text-red-600' : 'text-blue-600'

  return (
    <div className="rounded-xl bg-white p-4 text-center shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={'mt-1 text-lg font-bold sm:text-2xl ' + color}>{formatMoney(value)}</div>
    </div>
  )
}

// ---- 底部「快速添加一行」----
function QuickAdd({
  monthId,
  onAdded,
  onError,
}: {
  monthId: string
  onAdded: () => void
  onError: (msg: string) => void
}) {
  const [date, setDate] = useState('')
  const [desc, setDesc] = useState('')
  const [category, setCategory] = useState('')
  const [income, setIncome] = useState('')
  const [expense, setExpense] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    const inc = parseAmount(income)
    const exp = parseAmount(expense)
    if (inc === 0 && exp === 0) {
      onError('请在「收入」或「支出」里填一个金额。')
      return
    }
    setBusy(true)
    try {
      const isIncome = inc > 0
      await store.saveEntry({
        month_id: monthId,
        zone: isIncome ? 'income' : 'expense',
        entry_date: date || null,
        amount: isIncome ? inc : exp,
        category: category || null,
        description: desc || null,
        confidence: isIncome ? 'Confirmed' : null,
      })
      setDate('')
      setDesc('')
      setCategory('')
      setIncome('')
      setExpense('')
      onAdded()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') add()
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onKeyDown={onKey}
          className="w-36 rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
        />
        <input
          type="text"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={onKey}
          placeholder="说明（例如：卖货收入 / 买原料）"
          className="min-w-[150px] flex-1 rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
        >
          <option value="">分类…</option>
          {config.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          inputMode="decimal"
          value={income}
          onChange={(e) => setIncome(e.target.value)}
          onKeyDown={onKey}
          placeholder="收入"
          className="w-24 rounded border border-slate-300 px-2 py-1.5 text-right text-green-700 focus:border-green-500 focus:outline-none"
        />
        <input
          type="text"
          inputMode="decimal"
          value={expense}
          onChange={(e) => setExpense(e.target.value)}
          onKeyDown={onKey}
          placeholder="支出"
          className="w-24 rounded border border-slate-300 px-2 py-1.5 text-right text-red-600 focus:border-red-500 focus:outline-none"
        />
        <button
          onClick={add}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          ＋ 添加
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        填「收入」那格就记成收入，填「支出」那格就记成支出（两个只填一个）。填完按回车也行。
      </p>
    </div>
  )
}
