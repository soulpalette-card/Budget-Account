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
import { iconFor } from '../lib/icons'

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
  const [addTarget, setAddTarget] = useState<null | 'budget' | 'temp'>(null) // 记一笔弹窗目标

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
  const plannedEntries = allEntries.filter((e) => !e.is_unexpected) // 预算项
  const unexpectedEntries = allEntries.filter((e) => e.is_unexpected) // 临时新款
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
        sub_items: patch.sub_items !== undefined ? patch.sub_items : entry.sub_items,
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

  // 锁定 / 解锁本月预算
  async function toggleLock() {
    if (!currentMonth) return
    try {
      await store.updateMonth(currentMonth.id, { budget_locked: !currentMonth.budget_locked })
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>

  const locked = currentMonth?.budget_locked ?? false

  // 预算 vs 实际（本月净流，收−支），以及差异从哪来
  const budgetNet = round2(calc.plannedIncome - calc.plannedExpense)
  const actualNet = round2(calc.realizedIncome - calc.realizedExpense)
  const variance = round2(actualNet - budgetNet) // 差异 = 实际 − 预算
  const unsettled = plannedEntries.filter((e) => !e.settled) // 未实现的预算项
  const unsettledNet = round2(
    sumAmounts(unsettled.filter((e) => e.zone === 'income').map((e) => e.amount)) -
      sumAmounts(unsettled.filter((e) => e.zone === 'expense').map((e) => e.amount)),
  )
  const tempNet = round2(calc.unexpIncome - calc.unexpExpense) // 临时新款净额

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      {/* ===== 顶部工具条：月份 + 锁定 + 列印 ===== */}
      <div className="no-print flex items-center justify-between gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleLock}
            className={
              'rounded-full px-3 py-1 text-xs font-medium ' +
              (locked ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 border border-slate-300')
            }
            title={locked ? '预算已锁定，点击解锁' : '点击锁定预算（锁定后新记的自动进临时新款）'}
          >
            {locked ? '🔒 已锁定' : '🔓 锁定预算'}
          </button>
          <button onClick={() => window.print()} className="text-slate-500">
            🖨
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {msg && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      {/* ===== 窗口一：预算（深板岩蓝，沉稳“计划”感）===== */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 p-4 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-100">
            📋 预算 Budget（计划）{locked && ' 🔒'}
          </span>
          <span className="text-xs text-slate-400">预算结余</span>
        </div>
        <div
          className={
            'text-3xl font-extrabold ' +
            (calc.plannedClosing < 0 ? 'text-rose-400' : 'text-emerald-400')
          }
        >
          {formatMoney(calc.plannedClosing)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-white/10 px-3 py-1.5">
            <div className="text-xs text-slate-300">预算流出 · Cash Out</div>
            <div className="font-bold text-rose-300">-{formatMoney(calc.plannedExpense)}</div>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-1.5">
            <div className="text-xs text-slate-300">预算流入 · Cash In</div>
            <div className="font-bold text-emerald-300">+{formatMoney(calc.plannedIncome)}</div>
          </div>
        </div>
      </div>

      {/* ===== 窗口二：实际现金流（暖金，醇厚“到手钱”感）===== */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 p-4 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-950">💵 实际现金流 Actual</span>
          <span className="text-xs text-amber-900/80">实际结余</span>
        </div>
        <div
          className={
            'text-3xl font-extrabold ' +
            (calc.actualClosing < 0 ? 'text-red-800' : 'text-emerald-900')
          }
        >
          {formatMoney(calc.actualClosing)}
        </div>
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
        <div className="mt-2 text-right text-xs text-amber-900/90">
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
        </div>
      </div>

      {/* ===== 差异卡：差多少 + 哪里出问题 ===== */}
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">差异 Variance（实际 − 预算）</span>
          <span
            className={'text-xl font-extrabold ' + (variance < 0 ? 'text-red-600' : 'text-emerald-600')}
          >
            {variance >= 0 ? '+' : '-'}
            {compactNum(Math.abs(variance))}
          </span>
        </div>
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs">
          <div className="mb-1 text-slate-400">差异从哪来 👇</div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">
              🔸 未实现预算（计划了还没发生）· {unsettled.length} 笔
            </span>
            <span className="tabular-nums text-slate-500">{compactNum(unsettledNet)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">
              🔹 临时新款（计划外冒出来）· {unexpectedEntries.length} 笔
            </span>
            <span className="tabular-nums text-slate-500">{compactNum(tempNet)}</span>
          </div>
        </div>
      </div>

      {/* ===== 一行对照表：项目 ｜ 预算 ｜ 实际（手机也能左右对照）===== */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {/* 表头 */}
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-500">
          <span>项目 {locked && '🔒已锁'}</span>
          <span className="text-right">预算</span>
          <span className="text-right">实际 ✓</span>
        </div>

        {plannedEntries.length === 0 && unexpectedEntries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">
            还没有记录，点下面「＋ 加预算项」或「＋ 临时新款」
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {/* 预算项：预算列有数，实际列点一下才加入 */}
            {plannedEntries.map((e) => (
              <EntryItem
                key={e.id}
                entry={e}
                planned
                frozen={locked}
                onSave={saveField}
                onToggle={toggleSettled}
                onCopy={copyToNext}
                onRemove={removeRow}
              />
            ))}
            {/* 临时新款：只有实际列有数 */}
            {unexpectedEntries.length > 0 && (
              <div className="bg-emerald-50/60 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                临时新款（不在预算内）
              </div>
            )}
            {unexpectedEntries.map((e) => (
              <EntryItem
                key={e.id}
                entry={e}
                planned={false}
                onSave={saveField}
                onToggle={toggleSettled}
                onCopy={copyToNext}
                onRemove={removeRow}
              />
            ))}
          </div>
        )}

        {/* 合计（净）*/}
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold">
          <span className="text-slate-700">合计（收−支）</span>
          <span className="text-right tabular-nums text-slate-400">
            {compactNum(calc.plannedIncome - calc.plannedExpense)}
          </span>
          <span
            className={
              'text-right tabular-nums ' +
              (calc.realizedIncome - calc.realizedExpense < 0 ? 'text-red-600' : 'text-emerald-600')
            }
          >
            {compactNum(calc.realizedIncome - calc.realizedExpense)}
          </span>
        </div>

        {/* 添加按钮 */}
        <div className="flex border-t border-slate-100 text-sm">
          {!locked && (
            <button
              onClick={() => setAddTarget('budget')}
              className="flex-1 py-2.5 text-amber-600 hover:bg-amber-50"
            >
              ＋ 加预算项
            </button>
          )}
          <button
            onClick={() => setAddTarget('temp')}
            className={
              'flex-1 py-2.5 text-emerald-600 hover:bg-emerald-50 ' +
              (!locked ? 'border-l border-slate-100' : '')
            }
          >
            ＋ 临时新款
          </button>
        </div>
      </div>

      {/* ===== 记一笔弹窗 ===== */}
      {addTarget && (
        <AddSheet
          unexpected={addTarget === 'temp'}
          locked={locked && addTarget === 'temp'}
          monthId={selectedId}
          onClose={() => setAddTarget(null)}
          onAdded={() => load(selectedId)}
          onError={setError}
        />
      )}
    </div>
  )
}

// 紧凑金额（不带 RM，配合窄列）：负数用括号
function compactNum(n: number): string {
  const v = round2(n)
  const body = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return v < 0 ? `(${body})` : body
}

const inputCls =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none'

// ---- 一笔账：紧凑一行（图标 + 说明 + 金额 [+ 已实现圈]），点开展开编辑 ----
function EntryItem({
  entry: e,
  planned,
  frozen = false,
  onSave,
  onToggle,
  onCopy,
  onRemove,
}: {
  entry: Entry
  planned: boolean
  frozen?: boolean
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onToggle: (e: Entry) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isIncome = e.zone === 'income'
  const amtColor = isIncome ? 'text-emerald-600' : 'text-red-600'
  const signed = (isIncome ? '+' : '-') + compactNum(e.amount) // 例：+120,244.58 / -9,150.00

  // 子项目（拆单）本地编辑状态：金额先用字符串存，方便输入
  const [subs, setSubs] = useState<{ desc: string; amount: string }[]>(
    (e.sub_items ?? []).map((s) => ({ desc: s.desc, amount: s.amount.toFixed(2) })),
  )
  const subTotal = sumAmounts(subs.map((s) => parseAmount(s.amount)))

  // 存子项目到数据库（有子项目时，主金额自动=合计）
  function commitSubs(list: { desc: string; amount: string }[]) {
    const items = list
      .map((s) => ({ desc: s.desc.trim(), amount: parseAmount(s.amount) }))
      .filter((s) => s.amount !== 0 || s.desc !== '')
    onSave(e, { sub_items: items.length ? items : null })
  }
  // 开始拆分：把当前这一笔变成第一个子项目
  function startSplit() {
    const seeded = [{ desc: e.description || '明细1', amount: e.amount.toFixed(2) }]
    setSubs(seeded)
    commitSubs(seeded)
  }
  function addSub() {
    setSubs([...subs, { desc: '', amount: '' }])
  }
  function updateSub(i: number, patch: Partial<{ desc: string; amount: string }>) {
    setSubs(subs.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function removeSub(i: number) {
    const next = subs.filter((_, idx) => idx !== i)
    setSubs(next)
    commitSubs(next)
  }
  function cancelSplit() {
    setSubs([])
    onSave(e, { sub_items: null }) // 合并回一笔，金额保持当前合计
  }

  return (
    <div>
      {/* 收起态：项目 ｜ 预算 ｜ 实际（同一行左右对照）*/}
      <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 px-3 py-2">
        {/* 项目（点＝展开编辑）*/}
        <button onClick={() => setOpen(!open)} className="flex min-w-0 items-center gap-2 text-left">
          <span className="text-base">{iconFor(e)}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-700">
              {e.description || '（未填说明）'}
            </span>
            <span className="block truncate text-[10px] text-slate-400">
              {e.category || (isIncome ? '收入' : '支出')}
              {e.entry_date ? ' · ' + prettyDate(e.entry_date) : ''}
              {e.sub_items && e.sub_items.length > 0 ? ` · ${e.sub_items.length}项` : ''}
            </span>
          </span>
        </button>

        {/* 预算列：一律灰色（还没发生的计划）；临时新款没有预算，显示 — */}
        <span className={'text-right text-xs tabular-nums ' + (planned ? 'text-slate-400' : 'text-slate-300')}>
          {planned ? signed : '—'}
        </span>

        {/* 实际列：临时新款直接显示；预算项点一下才加入（○ / 金额）*/}
        <div className="text-right text-xs tabular-nums">
          {!planned ? (
            <span className={'font-semibold ' + amtColor}>{signed}</span>
          ) : e.settled ? (
            <button
              onClick={() => onToggle(e)}
              className={'no-print font-semibold ' + amtColor}
              title="已加入实际（点击移出）"
            >
              {signed}
            </button>
          ) : (
            <button
              onClick={() => onToggle(e)}
              className="no-print rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-emerald-400 hover:text-emerald-600"
              title="点一下：加入实际"
            >
              ＋加入
            </button>
          )}
        </div>
      </div>

      {/* 展开态：预算锁定时只读；否则可编辑 */}
      {open && frozen && (
        <div className="space-y-1 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <div>🔒 预算已锁定，这笔规划不能改。要修改请先点顶部「已锁定」解锁。</div>
          {e.sub_items && e.sub_items.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {e.sub_items.map((s, i) => (
                <div key={i} className="flex justify-between">
                  <span>· {s.desc || '（未填）'}</span>
                  <span>{formatMoney(s.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pt-1 text-right">
            <button onClick={() => onCopy(e)} className="text-amber-600 hover:text-amber-800">
              复制到下月
            </button>
          </div>
        </div>
      )}
      {open && !frozen && (
        <div className="space-y-2 bg-slate-50 px-4 py-3">
          {subs.length === 0 ? (
            <>
              {/* 普通模式：日期 + 金额 */}
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
              <button
                onClick={startSplit}
                className="text-xs text-amber-600 hover:text-amber-800"
              >
                ＋ 拆分成明细（一笔里有多张单据）
              </button>
            </>
          ) : (
            <>
              {/* 拆分模式：日期 + 子项目列表（自动加总）*/}
              <input
                type="date"
                defaultValue={e.entry_date ?? ''}
                onBlur={(ev) => {
                  const v = ev.target.value || null
                  if (v !== e.entry_date) onSave(e, { entry_date: v })
                }}
                className={inputCls}
              />
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span>明细（自动加总）</span>
                  <span className="font-semibold text-slate-700">
                    合计 {formatMoney(subTotal)}
                  </span>
                </div>
                {subs.map((s, i) => (
                  <div key={i} className="mb-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={s.desc}
                      onChange={(ev) => updateSub(i, { desc: ev.target.value })}
                      onBlur={() => commitSubs(subs)}
                      placeholder="小项目 如 复印机 / 电话费"
                      className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={s.amount}
                      onChange={(ev) => updateSub(i, { amount: ev.target.value })}
                      onBlur={() => commitSubs(subs)}
                      placeholder="金额"
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm focus:border-amber-500 focus:outline-none"
                    />
                    <button
                      onClick={() => removeSub(i)}
                      className="shrink-0 text-slate-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between">
                  <button onClick={addSub} className="text-xs text-amber-600 hover:text-amber-800">
                    ＋ 加一项
                  </button>
                  <button onClick={cancelSplit} className="text-xs text-slate-400 hover:text-slate-600">
                    取消拆分（合并回一笔）
                  </button>
                </div>
              </div>
            </>
          )}
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
  locked = false,
  monthId,
  onClose,
  onAdded,
  onError,
}: {
  unexpected: boolean
  locked?: boolean
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
            记一笔{unexpected ? '（临时增加）' : '（规划）'}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {locked && (
          <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            🔒 预算已锁定，这笔会记入「临时增加」。
          </div>
        )}

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
