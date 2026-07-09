// ============================================================================
// 文件摘要（Account.tsx）—— 首页「现金流控制台」（温暖记账风，共享账）
// ----------------------------------------------------------------------------
// 风格参考手机记账 App：金黄顶部卡片当仪表盘，下面按“天”分组的紧凑清单，
// 每笔带分类小图标，右下角一个大「＋ 记一笔」按钮。
//
// 仍然保留现金流控制的核心：
//   · 顶部切换 [规划] / [意外] 两个清单（一次只显示一个，界面清爽）
//   · 规划项每笔右边一个圈：○=还没发生，点一下 → ✅ 已实现，计入实际
//   · 意外项＝不在规划内的临时收支，直接计入实际
//   · 仪表盘：实际现金（大数字）+ 本月支出 / 本月收入 + 计划现金/差距
//   · 累计：下月期初 = 本月实际现金
// 数据共享（登录用户看同一份），全部走 store.ts。
// ============================================================================

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import * as store from '../lib/store'
import type { Entry, Month } from '../types'
import { config } from '../config'
import { formatMoney, parseAmount, round2, sumAmounts } from '../lib/money'
import { friendlyError } from '../lib/errors'

function currentYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
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

// 分类 → 小图标（找不到就按收入/支出给个默认）
const CATEGORY_ICON: Record<string, string> = {
  薪资: '💰',
  房租: '🏠',
  水电网络: '💡',
  原料采购: '📦',
  设备: '🛠️',
  市场推广: '📣',
  交通: '🚗',
  税费: '🧾',
  销售收入: '🛒',
  其他: '📌',
}
function iconFor(e: Entry): string {
  if (e.category && CATEGORY_ICON[e.category]) return CATEGORY_ICON[e.category]
  return e.zone === 'income' ? '💵' : '💸'
}

// 把 "2026-07-08" 变成 "7月8日"；空的显示“未定日期”
function prettyDate(d: string | null): string {
  if (!d) return '未定日期'
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  return `${Number(m[2])}月${Number(m[3])}日`
}

interface MonthCalc {
  opening: number
  plannedIncome: number
  plannedExpense: number
  realizedIncome: number
  realizedExpense: number
  unexpIncome: number
  unexpExpense: number
  plannedClosing: number
  actualClosing: number
  plannedCount: number
  realizedCount: number
}

function computeRunning(
  months: Month[],
  byMonth: Record<string, Entry[]>,
): Record<string, MonthCalc> {
  const result: Record<string, MonthCalc> = {}
  let carry: number | null = null
  for (const m of months) {
    const es = (byMonth[m.id] ?? []).filter((e) => !e.is_deleted)
    const plannedIncome = sumAmounts(
      es.filter((e) => !e.is_unexpected && e.zone === 'income').map((e) => e.amount),
    )
    const plannedExpense = sumAmounts(
      es.filter((e) => !e.is_unexpected && e.zone === 'expense').map((e) => e.amount),
    )
    const unexpIncome = sumAmounts(
      es.filter((e) => e.is_unexpected && e.zone === 'income').map((e) => e.amount),
    )
    const unexpExpense = sumAmounts(
      es.filter((e) => e.is_unexpected && e.zone === 'expense').map((e) => e.amount),
    )
    const realizedIncome = sumAmounts(
      es.filter((e) => e.zone === 'income' && (e.is_unexpected || e.settled)).map((e) => e.amount),
    )
    const realizedExpense = sumAmounts(
      es.filter((e) => e.zone === 'expense' && (e.is_unexpected || e.settled)).map((e) => e.amount),
    )
    const planned = es.filter((e) => !e.is_unexpected)
    const opening = carry === null ? round2(m.opening_balance) : carry
    const plannedClosing = round2(opening + plannedIncome - plannedExpense)
    const actualClosing = round2(opening + realizedIncome - realizedExpense)
    result[m.id] = {
      opening,
      plannedIncome,
      plannedExpense,
      realizedIncome,
      realizedExpense,
      unexpIncome,
      unexpExpense,
      plannedClosing,
      actualClosing,
      plannedCount: planned.length,
      realizedCount: planned.filter((e) => e.settled).length,
    }
    carry = actualClosing
  }
  return result
}

export function Account() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [months, setMonths] = useState<Month[]>([])
  const [byMonth, setByMonth] = useState<Record<string, Entry[]>>({})
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<'planned' | 'unexpected'>('planned') // 当前看哪个清单
  const [adding, setAdding] = useState(false) // 是否弹出“记一笔”面板

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

  const calcMap = useMemo(() => computeRunning(months, byMonth), [months, byMonth])
  const currentMonth = months.find((m) => m.id === selectedId)
  const isFirstMonth = months.length > 0 && months[0].id === selectedId
  const allEntries = (byMonth[selectedId] ?? []).filter((e) => !e.is_deleted)
  const plannedEntries = allEntries.filter((e) => !e.is_unexpected)
  const unexpectedEntries = allEntries.filter((e) => e.is_unexpected)
  const shownEntries = tab === 'planned' ? plannedEntries : unexpectedEntries
  // 按 收入 / 支出 分开，并各自算小计；合计 = 收入小计 − 支出小计
  const incomeItems = shownEntries.filter((e) => e.zone === 'income')
  const expenseItems = shownEntries.filter((e) => e.zone === 'expense')
  const incomeSub = sumAmounts(incomeItems.map((e) => e.amount))
  const expenseSub = sumAmounts(expenseItems.map((e) => e.amount))
  const listTotal = round2(incomeSub - expenseSub)
  const calc =
    calcMap[selectedId] ??
    ({
      opening: 0,
      plannedIncome: 0,
      plannedExpense: 0,
      realizedIncome: 0,
      realizedExpense: 0,
      unexpIncome: 0,
      unexpExpense: 0,
      plannedClosing: 0,
      actualClosing: 0,
      plannedCount: 0,
      realizedCount: 0,
    } as MonthCalc)

  async function saveField(entry: Entry, patch: Partial<Entry>) {
    try {
      await store.saveEntry({
        id: entry.id,
        month_id: entry.month_id,
        zone: patch.zone !== undefined ? patch.zone : entry.zone,
        entry_date: patch.entry_date !== undefined ? patch.entry_date : entry.entry_date,
        amount: patch.amount !== undefined ? patch.amount : entry.amount,
        category: patch.category !== undefined ? patch.category : entry.category,
        description: patch.description !== undefined ? patch.description : entry.description,
        confidence: entry.confidence,
        settled: entry.settled,
        is_unexpected: entry.is_unexpected,
        note: entry.note,
      })
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }
  async function toggleSettled(entry: Entry) {
    try {
      await store.setSettled(entry.id, !entry.settled)
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
  async function copyToNext(entry: Entry) {
    setMsg('')
    setError('')
    try {
      const idx = months.findIndex((m) => m.id === entry.month_id)
      let target = months[idx + 1]
      if (!target) {
        target = await store.addMonth({ label: nextLabel(months[idx].label), opening_balance: 0 })
      }
      await store.saveEntry({
        month_id: target.id,
        zone: entry.zone,
        entry_date: entry.entry_date,
        amount: entry.amount,
        category: entry.category,
        description: entry.description,
        confidence: entry.confidence,
        is_unexpected: entry.is_unexpected,
        settled: false,
        note: entry.note,
      })
      setMsg(`已复制「${entry.description ?? '这笔'}」到「${target.label}」。`)
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>

  const gap = round2(calc.actualClosing - calc.plannedClosing)

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      {/* ===== 金黄仪表盘 ===== */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-300 to-yellow-400 p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-sm text-amber-900">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="no-print rounded-md bg-white/40 px-2 py-1 font-medium text-amber-900 focus:outline-none"
          >
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/40 px-2 py-0.5 text-xs">共享账本</span>
            <button onClick={() => window.print()} className="no-print text-amber-900">
              🖨
            </button>
          </div>
        </div>

        {/* 大数字：实际结余（Actual Balance）*/}
        <div className="text-xs text-amber-900/80">实际结余 · Actual Balance</div>
        <div
          className={
            'text-3xl font-extrabold ' + (calc.actualClosing < 0 ? 'text-red-700' : 'text-slate-900')
          }
        >
          {formatMoney(calc.actualClosing)}
        </div>

        {/* 本月流入 / 流出 + 预算/差异 */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-white/40 px-3 py-1.5">
            <div className="text-xs text-amber-900/80">本月流出 · Cash Out</div>
            <div className="font-bold text-red-700">-{formatMoney(calc.realizedExpense)}</div>
          </div>
          <div className="rounded-lg bg-white/40 px-3 py-1.5">
            <div className="text-xs text-amber-900/80">本月流入 · Cash In</div>
            <div className="font-bold text-emerald-700">+{formatMoney(calc.realizedIncome)}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-amber-900/90">
          <span>
            预算结余 <b>{formatMoney(calc.plannedClosing)}</b>
          </span>
          <span>
            差异{' '}
            <b className={gap < 0 ? 'text-red-700' : 'text-emerald-800'}>{formatMoney(gap)}</b>
          </span>
          <span>
            承上结余{' '}
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
                className="w-20 rounded bg-white/50 px-1 py-0.5 text-right text-amber-900 focus:outline-none"
              />
            ) : (
              <b>{formatMoney(calc.opening)}</b>
            )}
          </span>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {msg && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      {/* ===== 切换：规划 / 意外 ===== */}
      <div className="no-print grid grid-cols-2 gap-2">
        <TabBtn active={tab === 'planned'} onClick={() => setTab('planned')}>
          规划 <span className="text-xs opacity-80">{calc.realizedCount}/{calc.plannedCount} 已实现</span>
        </TabBtn>
        <TabBtn active={tab === 'unexpected'} onClick={() => setTab('unexpected')}>
          意外 <span className="text-xs opacity-80">{unexpectedEntries.length} 笔</span>
        </TabBtn>
      </div>

      {/* ===== 结构化清单：① 收入  ② 支出  ③ 合计 ===== */}
      {shownEntries.length === 0 ? (
        <div className="rounded-2xl bg-white py-10 text-center text-sm text-slate-400 shadow-sm">
          还没有记录，点下面「＋ 记一笔」添加
        </div>
      ) : (
        <div className="space-y-3">
          {/* ① 收入 */}
          <ZoneGroup
            title="收入"
            tone="income"
            items={incomeItems}
            subtotal={incomeSub}
            planned={tab === 'planned'}
            onSave={saveField}
            onToggle={toggleSettled}
            onCopy={copyToNext}
            onRemove={removeRow}
          />
          {/* ② 支出 */}
          <ZoneGroup
            title="支出"
            tone="expense"
            items={expenseItems}
            subtotal={expenseSub}
            planned={tab === 'planned'}
            onSave={saveField}
            onToggle={toggleSettled}
            onCopy={copyToNext}
            onRemove={removeRow}
          />
          {/* ③ 合计 */}
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
            <span className="font-bold text-slate-700">合计（收入 − 支出）</span>
            <span
              className={
                'text-lg font-extrabold ' + (listTotal < 0 ? 'text-red-600' : 'text-emerald-600')
              }
            >
              {formatMoney(listTotal)}
            </span>
          </div>
        </div>
      )}

      {/* ===== 底部大「＋ 记一笔」按钮（悬浮） ===== */}
      <button
        onClick={() => setAdding(true)}
        className="no-print fixed bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-500 px-6 py-3 font-bold text-white shadow-lg hover:bg-amber-600"
      >
        ＋ 记一笔{tab === 'unexpected' ? '（意外）' : '（规划）'}
      </button>

      {/* ===== 记一笔弹窗 ===== */}
      {adding && (
        <AddSheet
          unexpected={tab === 'unexpected'}
          monthId={selectedId}
          onClose={() => setAdding(false)}
          onAdded={() => load(selectedId)}
          onError={setError}
        />
      )}
    </div>
  )
}

// ---- 切换按钮 ----
function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-xl py-2 text-sm font-semibold shadow-sm ' +
        (active ? 'bg-amber-500 text-white' : 'bg-white text-slate-500')
      }
    >
      {children}
    </button>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none'

// ---- 一组（收入 或 支出）：带小计的卡片 ----
function ZoneGroup({
  title,
  tone,
  items,
  subtotal,
  planned,
  onSave,
  onToggle,
  onCopy,
  onRemove,
}: {
  title: string
  tone: 'income' | 'expense'
  items: Entry[]
  subtotal: number
  planned: boolean
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onToggle: (e: Entry) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const color = tone === 'income' ? 'text-emerald-600' : 'text-red-600'
  const sign = tone === 'income' ? '+' : '−'
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {/* 组标题 + 小计 */}
      <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
        <span className="text-sm font-bold text-slate-700">
          {title}
          <span className="ml-2 text-xs font-normal text-slate-400">{items.length} 笔</span>
        </span>
        <span className={'text-sm font-bold ' + color}>
          {sign}
          {formatMoney(subtotal)}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-3 text-center text-xs text-slate-400">（无）</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {items.map((e) => (
            <EntryItem
              key={e.id}
              entry={e}
              planned={planned}
              onSave={onSave}
              onToggle={onToggle}
              onCopy={onCopy}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- 一笔账：紧凑一行（图标 + 说明 + 金额 [+ 已实现圈]），点开展开编辑 ----
function EntryItem({
  entry: e,
  planned,
  onSave,
  onToggle,
  onCopy,
  onRemove,
}: {
  entry: Entry
  planned: boolean
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onToggle: (e: Entry) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isIncome = e.zone === 'income'
  const realized = e.is_unexpected || e.settled
  // 金额颜色：已实现才上色；规划里没打勾的显灰色（表示还没发生）
  const amtColor = !realized ? 'text-slate-300' : isIncome ? 'text-emerald-600' : 'text-red-600'
  const sign = isIncome ? '+' : '−'

  return (
    <div>
      {/* 收起态：一小行 */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-xl">{iconFor(e)}</span>
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-sm text-slate-700">
            {e.description || '（未填说明）'}
          </span>
          <span className="truncate text-[11px] text-slate-400">
            {e.category || (isIncome ? '收入' : '支出')}
            {e.entry_date ? ' · ' + prettyDate(e.entry_date) : ''}
          </span>
        </button>
        <span className={'shrink-0 text-sm font-semibold ' + amtColor}>
          {sign}
          {formatMoney(e.amount)}
        </span>
        {/* 规划项：右边一个圈，点一下打勾/取消 */}
        {planned && (
          <button
            onClick={() => onToggle(e)}
            className={
              'no-print flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ' +
              (e.settled
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-slate-300 text-transparent')
            }
            title={e.settled ? '已实现（点击取消）' : '点一下：标记已实现'}
          >
            ✓
          </button>
        )}
      </div>

      {/* 展开态：编辑 */}
      {open && (
        <div className="space-y-2 bg-slate-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              defaultValue={e.entry_date ?? ''}
              onBlur={(ev) => {
                const v = ev.target.value || null
                if (v !== e.entry_date) onSave(e, { entry_date: v })
              }}
              className={inputCls}
            />
            <input
              type="text"
              inputMode="decimal"
              defaultValue={e.amount.toFixed(2)}
              onBlur={(ev) => {
                const v = parseAmount(ev.target.value)
                ev.target.value = v.toFixed(2)
                if (v !== e.amount) onSave(e, { amount: v })
              }}
              className={inputCls + ' text-right'}
            />
          </div>
          <input
            type="text"
            defaultValue={e.description ?? ''}
            placeholder="说明…"
            onBlur={(ev) => {
              const v = ev.target.value || null
              if (v !== e.description) onSave(e, { description: v })
            }}
            className={inputCls}
          />
          <div className="flex items-center gap-2">
            <select
              defaultValue={e.category ?? ''}
              onChange={(ev) => onSave(e, { category: ev.target.value || null })}
              className={inputCls + ' flex-1'}
            >
              <option value="">（未分类）</option>
              {config.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={() => onSave(e, { zone: isIncome ? 'expense' : 'income' })}
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              {isIncome ? '改为支出' : '改为收入'}
            </button>
          </div>
          <div className="flex items-center justify-end gap-4 text-xs">
            <button onClick={() => onCopy(e)} className="text-amber-600 hover:text-amber-800">
              复制到下月
            </button>
            <button onClick={() => onRemove(e.id)} className="text-slate-400 hover:text-red-600">
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 「记一笔」底部弹窗 ----
function AddSheet({
  unexpected,
  monthId,
  onClose,
  onAdded,
  onError,
}: {
  unexpected: boolean
  monthId: string
  onClose: () => void
  onAdded: () => void
  onError: (msg: string) => void
}) {
  const [dir, setDir] = useState<'expense' | 'income'>('expense') // 支出 / 收入
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const amt = parseAmount(amount)
    if (amt <= 0) {
      onError('请填一个大于 0 的金额。')
      return
    }
    setBusy(true)
    try {
      await store.saveEntry({
        month_id: monthId,
        zone: dir,
        entry_date: date || null,
        amount: amt,
        category: category || null,
        description: desc || null,
        confidence: dir === 'income' ? 'Confirmed' : null,
        is_unexpected: unexpected,
        settled: unexpected ? true : false,
      })
      onAdded()
      onClose()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter') save()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-bold text-slate-800">
            记一笔{unexpected ? '（意外）' : '（规划）'}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {/* 支出 / 收入 切换 */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setDir('expense')}
            className={
              'rounded-lg py-2 text-sm font-semibold ' +
              (dir === 'expense' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500')
            }
          >
            支出
          </button>
          <button
            onClick={() => setDir('income')}
            className={
              'rounded-lg py-2 text-sm font-semibold ' +
              (dir === 'income' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500')
            }
          >
            收入
          </button>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onKey}
            placeholder="金额"
            autoFocus
            className={inputCls + ' text-right text-lg'}
          />
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={onKey}
            placeholder="说明（例如：房租 / 卖货收入）"
            className={inputCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            >
              <option value="">分类…</option>
              {config.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onKeyDown={onKey}
              className={inputCls}
            />
          </div>
          <button
            onClick={save}
            disabled={busy}
            className="w-full rounded-lg bg-amber-500 py-2.5 font-bold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
