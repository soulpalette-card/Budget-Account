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
import { useI18n } from '../lib/i18n'

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
  const { t } = useI18n()
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
  // 按日期排序（没填日期的排最后）
  const byDate = (a: Entry, b: Entry) => {
    const da = a.entry_date ?? '9999-99-99'
    const db = b.entry_date ?? '9999-99-99'
    return da < db ? -1 : da > db ? 1 : 0
  }
  const incomeRows = allEntries.filter((e) => e.zone === 'income').sort(byDate) // 收入框
  const expenseRows = allEntries.filter((e) => e.zone === 'expense').sort(byDate) // 支出框
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

  if (loading)
    return <div className="py-16 text-center text-slate-500">{t('加载中…', 'Loading…')}</div>

  const locked = false // 锁定功能已移除

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
      {/* ===== 顶部工具条：月份 + 列印 ===== */}
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
            📋 {t('预算 Budget（计划）', 'Budget (Plan)')}
            {locked && ' 🔒'}
          </span>
          <span className="text-xs text-slate-400">{t('预算结余', 'Budget balance')}</span>
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
            <div className="text-xs text-slate-300">{t('预算流出', 'Budget Out')} · Cash Out</div>
            <div className="font-bold text-rose-300">-{formatMoney(calc.plannedExpense)}</div>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-1.5">
            <div className="text-xs text-slate-300">{t('预算流入', 'Budget In')} · Cash In</div>
            <div className="font-bold text-emerald-300">+{formatMoney(calc.plannedIncome)}</div>
          </div>
        </div>
      </div>

      {/* ===== 窗口二：实际现金流（暖金，醇厚“到手钱”感）===== */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 p-4 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-950">
            💵 {t('实际现金流 Actual', 'Actual Cash Flow')}
          </span>
          <span className="text-xs text-amber-900/80">{t('实际结余', 'Actual balance')}</span>
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
            <div className="text-xs text-amber-900/80">{t('本月流出', 'Cash Out')} · Cash Out</div>
            <div className="font-bold text-red-700">-{formatMoney(calc.realizedExpense)}</div>
          </div>
          <div className="rounded-lg bg-white/40 px-3 py-1.5">
            <div className="text-xs text-amber-900/80">{t('本月流入', 'Cash In')} · Cash In</div>
            <div className="font-bold text-emerald-700">+{formatMoney(calc.realizedIncome)}</div>
          </div>
        </div>
        <div className="mt-2 text-right text-xs text-amber-900/90">
          {t('承上结余', 'Balance b/f')}{' '}
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
        {/* 标题 + 大数字：竖排，不再挤一行 */}
        <div className="text-xs font-semibold text-slate-500">
          {t('差异 Variance · 实际 − 预算', 'Variance · Actual − Budget')}
        </div>
        <div
          className={
            'text-2xl font-extrabold ' + (variance < 0 ? 'text-red-600' : 'text-emerald-600')
          }
        >
          {variance >= 0 ? '+' : '-'}
          {compactNum(Math.abs(variance))}
        </div>

        <div className="mt-3 space-y-2 border-t border-slate-100 pt-2 text-xs">
          <div className="text-slate-400">{t('差异从哪来 👇', 'Where the gap comes from 👇')}</div>
          {/* 每行：标签左（可换行）＋ 金额右上对齐 */}
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-slate-500">
              🔸 {t('未实现预算', 'Budget not yet realized')} · {unsettled.length}{' '}
              {t('笔', '')}
              <span className="block text-[11px] text-slate-400">
                {t('（计划了还没发生）', '(planned, not happened yet)')}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
              {compactNum(unsettledNet)}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-slate-500">
              🔹 {t('临时新款', 'Extra items')} · {unexpectedEntries.length} {t('笔', '')}
              <span className="block text-[11px] text-slate-400">
                {t('（计划外冒出来）', '(unplanned)')}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
              {compactNum(tempNet)}
            </span>
          </div>
        </div>
      </div>

      {/* ===== 收入框 / 支出框：分开、按日期排序 ===== */}
      <ZoneBox
        title={t('收入 Income', 'Income')}
        tone="income"
        rows={incomeRows}
        budgetSub={calc.plannedIncome}
        actualSub={calc.realizedIncome}
        onSave={saveField}
        onToggle={toggleSettled}
        onCopy={copyToNext}
        onRemove={removeRow}
      />
      <ZoneBox
        title={t('支出 Expense', 'Expense')}
        tone="expense"
        rows={expenseRows}
        budgetSub={calc.plannedExpense}
        actualSub={calc.realizedExpense}
        onSave={saveField}
        onToggle={toggleSettled}
        onCopy={copyToNext}
        onRemove={removeRow}
      />

      {/* 添加按钮 */}
      <div className="flex overflow-hidden rounded-2xl bg-white text-sm shadow-sm">
        <button
          onClick={() => setAddTarget('budget')}
          className="flex-1 py-2.5 text-amber-600 hover:bg-amber-50"
        >
          {t('＋ 加预算项', '＋ Budget item')}
        </button>
        <button
          onClick={() => setAddTarget('temp')}
          className="flex-1 border-l border-slate-100 py-2.5 text-emerald-600 hover:bg-emerald-50"
        >
          {t('＋ 临时新款', '＋ Extra')}
        </button>
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

// ---- 收入框 / 支出框：一个框只放一种，按日期排好，底部带小计 ----
function ZoneBox({
  title,
  tone,
  rows,
  budgetSub,
  actualSub,
  onSave,
  onToggle,
  onCopy,
  onRemove,
}: {
  title: string
  tone: 'income' | 'expense'
  rows: Entry[]
  budgetSub: number
  actualSub: number
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onToggle: (e: Entry) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const { t } = useI18n()
  const isInc = tone === 'income'
  const color = isInc ? 'text-emerald-600' : 'text-red-600'
  const sgn = isInc ? '+' : '-'
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {/* 框标题 + 列名 */}
      <div
        className={
          'grid grid-cols-[1fr_5rem_5rem] items-center gap-1 px-3 py-2 ' +
          (isInc ? 'bg-emerald-50' : 'bg-red-50')
        }
      >
        <span className={'text-sm font-bold ' + (isInc ? 'text-emerald-700' : 'text-red-700')}>
          {title}
          <span className="ml-1 text-[11px] font-normal text-slate-400">
            {rows.length} {t('笔', '')}
          </span>
        </span>
        <span className="text-right text-[11px] font-semibold text-slate-500">
          {t('预算', 'Budget')}
        </span>
        <span className="text-right text-[11px] font-semibold text-slate-500">
          {t('实际', 'Actual')} ✓
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-slate-400">
          {t('还没有记录', 'No records yet')}
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {rows.map((e) => (
            <EntryItem
              key={e.id}
              entry={e}
              planned={!e.is_unexpected}
              onSave={onSave}
              onToggle={onToggle}
              onCopy={onCopy}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      {/* 小计 */}
      <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold">
        <span className="text-slate-700">{t('小计', 'Subtotal')}</span>
        <span className="text-right tabular-nums text-slate-400">
          {sgn}
          {compactNum(budgetSub)}
        </span>
        <span className={'text-right tabular-nums ' + color}>
          {sgn}
          {compactNum(actualSub)}
        </span>
      </div>
    </div>
  )
}

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
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const isIncome = e.zone === 'income'
  const amtColor = isIncome ? 'text-emerald-600' : 'text-red-600'
  const signed = (isIncome ? '+' : '-') + compactNum(e.amount) // 例：+120,244.58 / -9,150.00

  // 编辑草稿：改动先存这里，点 ✅ 才写回数据库（避免手机上自动保存没触发）
  const [draft, setDraft] = useState({
    entry_date: e.entry_date ?? '',
    amount: e.amount.toFixed(2),
    description: e.description ?? '',
    category: e.category ?? '',
    zone: e.zone as Entry['zone'],
  })
  // 子项目（拆单）本地编辑状态：金额先用字符串存，方便输入
  const [subs, setSubs] = useState<{ desc: string; amount: string }[]>(
    (e.sub_items ?? []).map((s) => ({ desc: s.desc, amount: s.amount.toFixed(2) })),
  )
  const subTotal = sumAmounts(subs.map((s) => parseAmount(s.amount)))
  const draftIsIncome = draft.zone === 'income'

  // 把草稿还原成当前记录的值（打开/取消时用）
  function resetDraft() {
    setDraft({
      entry_date: e.entry_date ?? '',
      amount: e.amount.toFixed(2),
      description: e.description ?? '',
      category: e.category ?? '',
      zone: e.zone,
    })
    setSubs((e.sub_items ?? []).map((s) => ({ desc: s.desc, amount: s.amount.toFixed(2) })))
  }
  // 打开编辑（先把草稿对齐当前值）
  function openEditor() {
    resetDraft()
    setOpen(true)
  }
  // ✅ 确认：把草稿一次性写回
  function confirmEdit() {
    const patch: Partial<Entry> = {
      entry_date: draft.entry_date || null,
      description: draft.description || null,
      category: draft.category || null,
      zone: draft.zone,
    }
    if (subs.length > 0) {
      patch.sub_items = subs
        .map((s) => ({ desc: s.desc.trim(), amount: parseAmount(s.amount) }))
        .filter((s) => s.amount !== 0 || s.desc !== '')
    } else {
      patch.amount = parseAmount(draft.amount)
      patch.sub_items = null
    }
    onSave(e, patch)
    setOpen(false)
  }
  // ❎ 取消：丢弃改动
  function cancelEdit() {
    resetDraft()
    setOpen(false)
  }

  // 拆分（只改本地草稿，等 ✅ 才存）
  function startSplit() {
    setSubs([{ desc: draft.description || '', amount: draft.amount }])
  }
  function addSub() {
    setSubs([...subs, { desc: '', amount: '' }])
  }
  function updateSub(i: number, patch: Partial<{ desc: string; amount: string }>) {
    setSubs(subs.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function removeSub(i: number) {
    setSubs(subs.filter((_, idx) => idx !== i))
  }
  function cancelSplit() {
    setSubs([])
  }

  return (
    <div>
      {/* 收起态：项目 ｜ 预算 ｜ 实际（同一行左右对照）*/}
      <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 px-3 py-2">
        {/* 项目（点＝展开编辑）*/}
        <button
          onClick={() => (open ? cancelEdit() : openEditor())}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className="text-base">{iconFor(e)}</span>
          <span className="min-w-0">
            {/* 日期明显显示：橙色小标签 */}
            <span className="mb-0.5 flex items-center gap-1">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {e.entry_date ? prettyDate(e.entry_date) : t('无日期', 'No date')}
              </span>
              {e.is_unexpected && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                  {t('临时', 'Extra')}
                </span>
              )}
            </span>
            <span className="block truncate text-sm text-slate-700">
              {e.description || t('（未填说明）', '(no description)')}
            </span>
            <span className="block truncate text-[10px] text-slate-400">
              {e.category || (isIncome ? t('收入', 'Income') : t('支出', 'Expense'))}
              {e.sub_items && e.sub_items.length > 0
                ? ` · ${e.sub_items.length}${t('项', ' items')}`
                : ''}
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
              title={t('已加入实际（点击移出）', 'In actual (tap to remove)')}
            >
              {signed}
            </button>
          ) : (
            <button
              onClick={() => onToggle(e)}
              className="no-print rounded bg-slate-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
              title={t('点一下：加入实际', 'Tap to add to actual')}
            >
              {t('＋加入', '＋Add')}
            </button>
          )}
        </div>
      </div>

      {/* 展开态：预算锁定时只读；否则可编辑 */}
      {open && frozen && (
        <div className="space-y-1 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <div>
            {t(
              '🔒 预算已锁定，这笔规划不能改。要修改请先点顶部「已锁定」解锁。',
              '🔒 Budget locked — this item can’t be edited. Unlock at the top first.',
            )}
          </div>
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
              {t('复制到下月', 'Copy to next month')}
            </button>
          </div>
        </div>
      )}
      {open && !frozen && (
        <div className="space-y-2 bg-slate-50 px-4 py-3">
          {subs.length === 0 ? (
            <>
              {/* 普通模式：日期 + 金额（改动只进草稿，点 ✅ 才存）*/}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={draft.entry_date}
                  onChange={(ev) => setDraft({ ...draft, entry_date: ev.target.value })}
                  className={inputCls}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(ev) => setDraft({ ...draft, amount: ev.target.value })}
                  placeholder={t('金额', 'Amount')}
                  className={inputCls + ' text-right'}
                />
              </div>
              <button onClick={startSplit} className="text-xs text-amber-600 hover:text-amber-800">
                {t('＋ 拆分成明细（一笔里有多张单据）', '＋ Split into items (multiple receipts)')}
              </button>
            </>
          ) : (
            <>
              {/* 拆分模式：日期 + 子项目列表（自动加总）*/}
              <input
                type="date"
                value={draft.entry_date}
                onChange={(ev) => setDraft({ ...draft, entry_date: ev.target.value })}
                className={inputCls}
              />
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{t('明细（自动加总）', 'Items (auto-summed)')}</span>
                  <span className="font-semibold text-slate-700">
                    {t('合计', 'Total')} {formatMoney(subTotal)}
                  </span>
                </div>
                {subs.map((s, i) => (
                  <div key={i} className="mb-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={s.desc}
                      onChange={(ev) => updateSub(i, { desc: ev.target.value })}
                      placeholder={t('小项目 如 复印机 / 电话费', 'Item e.g. Copier / Phone')}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={s.amount}
                      onChange={(ev) => updateSub(i, { amount: ev.target.value })}
                      placeholder={t('金额', 'Amount')}
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
                    {t('＋ 加一项', '＋ Add item')}
                  </button>
                  <button onClick={cancelSplit} className="text-xs text-slate-400 hover:text-slate-600">
                    {t('取消拆分（合并回一笔）', 'Cancel split (merge back)')}
                  </button>
                </div>
              </div>
            </>
          )}
          <input
            type="text"
            value={draft.description}
            placeholder={t('说明…', 'Description…')}
            onChange={(ev) => setDraft({ ...draft, description: ev.target.value })}
            className={inputCls}
          />
          <div className="flex items-center gap-2">
            <select
              value={draft.category}
              onChange={(ev) => setDraft({ ...draft, category: ev.target.value })}
              className={inputCls + ' flex-1'}
            >
              <option value="">{t('（未分类）', '(No category)')}</option>
              {config.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                setDraft({ ...draft, zone: draftIsIncome ? 'expense' : 'income' })
              }
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              {draftIsIncome ? t('改为支出', 'To Expense') : t('改为收入', 'To Income')}
            </button>
          </div>

          {/* ✅ 确认 / ❎ 取消 —— 填好点 ✅ 才保存 */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={confirmEdit}
              className="flex-1 rounded-lg bg-emerald-500 py-2 text-sm font-bold text-white hover:bg-emerald-600"
            >
              ✅ {t('确认', 'Confirm')}
            </button>
            <button
              onClick={cancelEdit}
              className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-bold text-slate-600 hover:bg-slate-300"
            >
              ❎ {t('取消', 'Cancel')}
            </button>
          </div>
          <div className="flex items-center justify-end gap-4 text-xs">
            <button onClick={() => onCopy(e)} className="text-amber-600 hover:text-amber-800">
              {t('复制到下月', 'Copy to next month')}
            </button>
            <button onClick={() => onRemove(e.id)} className="text-slate-400 hover:text-red-600">
              {t('删除', 'Delete')}
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
  const { t } = useI18n()
  const [dir, setDir] = useState<'expense' | 'income'>('expense') // 支出 / 收入
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const amt = parseAmount(amount)
    if (amt <= 0) {
      onError(t('请填一个大于 0 的金额。', 'Please enter an amount greater than 0.'))
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
            {t('记一笔', 'New entry')}
            {unexpected ? t('（临时新款）', ' (Extra)') : t('（规划）', ' (Budget)')}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {locked && (
          <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {t('🔒 预算已锁定，这笔会记入「临时新款」。', '🔒 Budget locked — this goes to “Extra”.')}
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
            {t('支出', 'Expense')}
          </button>
          <button
            onClick={() => setDir('income')}
            className={
              'rounded-lg py-2 text-sm font-semibold ' +
              (dir === 'income' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500')
            }
          >
            {t('收入', 'Income')}
          </button>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('金额', 'Amount')}
            autoFocus
            className={inputCls + ' text-right text-lg'}
          />
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('说明（例如：房租 / 卖货收入）', 'Description (e.g. Rent / Sales)')}
            className={inputCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            >
              <option value="">{t('分类…', 'Category…')}</option>
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
            {t('保存', 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
