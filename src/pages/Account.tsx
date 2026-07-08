// ============================================================================
// 文件摘要（Account.tsx）—— 首页「账户」：本月规划 vs 实际（共享账，手机友好）
// ----------------------------------------------------------------------------
// 这是老板 + 财务共管的主界面。用法：
//   1. 月初把这个月【规划】的收入/支出填进「① 本月规划」
//   2. 规划的事真的发生了 → 点那一行的「✅ 已实现」打勾
//   3. 临时冒出来、不在规划里的收支 → 填进「🔺 意外项目」
//
// 顶部三个大数字：
//   · 计划现金（冻结）= 期初 + 全部规划收入 − 全部规划支出（月初定好就不变）
//   · 实际现金        = 期初 + 【已打勾】的规划 + 全部意外（真正发生的钱）
//   · 差距            = 实际 − 计划（正=比计划好，负=比计划差）
//
// 【累计】下个月期初 = 上个月的“实际现金”，一路往下滚。第一个月期初手填。
// 数据都是【共享】的：任何登录用户看到、改的是同一份公司账（靠数据库 RLS）。
// 数据走 store.ts。
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

// 一个月算出来的各种合计
interface MonthCalc {
  opening: number
  plannedIncome: number
  plannedExpense: number
  realizedIncome: number
  realizedExpense: number
  unexpIncome: number
  unexpExpense: number
  plannedClosing: number // 计划现金（冻结）
  actualClosing: number // 实际现金
  plannedCount: number // 规划项笔数
  realizedCount: number // 已打勾的规划项笔数
}

// 把所有月份按顺序滚一遍，算每月的计划/实际，并把“实际”结转给下个月当期初
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
    // 已实现 = 打了勾的规划项 + 全部意外项
    const realizedIncome = sumAmounts(
      es
        .filter((e) => e.zone === 'income' && (e.is_unexpected || e.settled))
        .map((e) => e.amount),
    )
    const realizedExpense = sumAmounts(
      es
        .filter((e) => e.zone === 'expense' && (e.is_unexpected || e.settled))
        .map((e) => e.amount),
    )

    const planned = es.filter((e) => !e.is_unexpected)
    const plannedCount = planned.length
    const realizedCount = planned.filter((e) => e.settled).length

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
      plannedCount,
      realizedCount,
    }
    carry = actualClosing // 实际现金结转给下个月
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

  // ---- 操作，改完都重载 ----
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
        settled: false, // 复制到下月默认“未实现”，等真发生了再打勾
        note: entry.note,
      })
      setMsg(`已把「${entry.description ?? '这笔'}」复制到下个月「${target.label}」。`)
      load(selectedId)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>

  const gap = round2(calc.actualClosing - calc.plannedClosing)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* 打印标题 */}
      <div className="print-only mb-2">
        <h1 className="text-lg font-bold">UNIKOYO 现金流 — {currentMonth?.label}</h1>
      </div>

      {/* 工具行 */}
      <div className="no-print space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-500">月份</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              {months.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => window.print()}
            className="mt-5 shrink-0 rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100"
          >
            🖨 列印
          </button>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">
            {isFirstMonth ? '期初余额（第一个月，手填）' : '期初（上月实际结转，自动）'}
          </label>
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-right focus:border-blue-500 focus:outline-none"
            />
          ) : (
            <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-right text-slate-600">
              {formatMoney(calc.opening)}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="no-print rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {msg && (
        <div className="no-print rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>
      )}

      {/* 三个大数字：计划现金 / 实际现金 / 差距 */}
      <div className="grid grid-cols-3 gap-3">
        <BigStat label="计划现金（冻结）" value={calc.plannedClosing} tone="plan" />
        <BigStat label="实际现金" value={calc.actualClosing} tone="actual" />
        <BigStat label="差距（实际−计划）" value={gap} tone="gap" />
      </div>

      {/* 一行小汇总 */}
      <div className="grid grid-cols-1 gap-2 rounded-xl bg-white p-3 text-sm shadow-sm sm:grid-cols-3">
        <div>
          规划：<span className="text-green-600">收 {formatMoney(calc.plannedIncome)}</span> ／{' '}
          <span className="text-red-600">支 {formatMoney(calc.plannedExpense)}</span>
        </div>
        <div>
          已实现：
          <span className="font-semibold text-blue-600">
            {calc.realizedCount}/{calc.plannedCount} 笔
          </span>
        </div>
        <div>
          意外：<span className="text-green-600">收 {formatMoney(calc.unexpIncome)}</span> ／{' '}
          <span className="text-red-600">支 {formatMoney(calc.unexpExpense)}</span>
        </div>
      </div>

      {/* ① 本月规划 */}
      <Section
        title="① 本月规划"
        hint="月初预计的收支。真的发生了就点右边「已实现」打勾 ✅。"
        entries={plannedEntries}
        showCheck={true}
        onSave={saveField}
        onToggle={toggleSettled}
        onCopy={copyToNext}
        onRemove={removeRow}
      />
      <AddForm
        title="添加规划项"
        unexpected={false}
        monthId={selectedId}
        onAdded={() => load(selectedId)}
        onError={setError}
      />

      {/* 🔺 意外项目 */}
      <div className="rounded-xl border-2 border-red-200 bg-red-50/40 p-1">
        <Section
          title="🔺 意外项目（不在规划内）"
          hint="临时冒出来、月初没算到的收支。填进来就直接算进“实际现金”。"
          entries={unexpectedEntries}
          showCheck={false}
          onSave={saveField}
          onToggle={toggleSettled}
          onCopy={copyToNext}
          onRemove={removeRow}
          danger
        />
      </div>
      <AddForm
        title="添加意外项"
        unexpected={true}
        monthId={selectedId}
        onAdded={() => load(selectedId)}
        onError={setError}
      />

      <p className="no-print px-1 text-xs text-slate-400">
        计划现金月初定好就冻结不变；实际现金 = 期初 + 已打勾的规划 + 全部意外。
        下个月期初 = 这个月的实际现金。删掉的行可在「设置」里恢复。
      </p>
    </div>
  )
}

// ---- 顶部大数字 ----
function BigStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'plan' | 'actual' | 'gap'
}) {
  let color = 'text-slate-700'
  if (tone === 'plan') color = 'text-slate-700'
  else if (tone === 'actual') color = value < 0 ? 'text-red-600' : 'text-blue-600'
  else color = value < 0 ? 'text-red-600' : 'text-green-600'
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={'mt-1 text-base font-bold sm:text-2xl ' + color}>{formatMoney(value)}</div>
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'

// ============================================================================
// 一个区块（规划 / 意外通用）：手机卡片 + 电脑表格
// ============================================================================
function Section({
  title,
  hint,
  entries,
  showCheck,
  onSave,
  onToggle,
  onCopy,
  onRemove,
  danger = false,
}: {
  title: string
  hint: string
  entries: Entry[]
  showCheck: boolean
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onToggle: (e: Entry) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
  danger?: boolean
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <h3 className={'text-lg font-bold ' + (danger ? 'text-red-600' : 'text-slate-800')}>
        {title}
      </h3>
      <p className="mb-3 text-xs text-slate-400">{hint}</p>

      {/* 手机版卡片 */}
      <div className="space-y-2 md:hidden print:hidden">
        {entries.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">还没有记录</div>
        ) : (
          entries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              showCheck={showCheck}
              onSave={onSave}
              onToggle={onToggle}
              onCopy={onCopy}
              onRemove={onRemove}
            />
          ))
        )}
      </div>

      {/* 电脑/打印版表格 */}
      <div className="hidden overflow-x-auto md:block print:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              {showCheck && <th className="px-2 py-2 text-center">已实现</th>}
              <th className="px-2 py-2">日期</th>
              <th className="px-2 py-2">说明</th>
              <th className="px-2 py-2">分类</th>
              <th className="px-2 py-2 text-right text-green-700">收入</th>
              <th className="px-2 py-2 text-right text-red-600">支出</th>
              <th className="no-print px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={showCheck ? 7 : 6} className="px-2 py-4 text-center text-slate-400">
                  还没有记录
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                showCheck={showCheck}
                onSave={onSave}
                onToggle={onToggle}
                onCopy={onCopy}
                onRemove={onRemove}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---- 手机卡片 ----
function EntryCard({
  entry: e,
  showCheck,
  onSave,
  onToggle,
  onCopy,
  onRemove,
}: {
  entry: Entry
  showCheck: boolean
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onToggle: (e: Entry) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const isIncome = e.zone === 'income'
  const done = e.settled
  return (
    <div
      className={
        'rounded-xl border p-3 shadow-sm ' +
        (showCheck && done ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white')
      }
    >
      {/* 规划项：顶部一个大大的“已实现”打勾按钮 */}
      {showCheck && (
        <button
          onClick={() => onToggle(e)}
          className={
            'mb-2 w-full rounded-md py-2 text-sm font-medium ' +
            (done
              ? 'bg-green-600 text-white'
              : 'border border-slate-300 text-slate-500 hover:bg-slate-50')
          }
        >
          {done ? '✅ 已实现（点我取消）' : '⬜ 点我打勾：已实现'}
        </button>
      )}
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
        <div className="flex items-center gap-2">
          <span
            className={
              'shrink-0 rounded px-1.5 py-1 text-xs font-medium ' +
              (isIncome ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')
            }
          >
            {isIncome ? '收' : '支'}
          </span>
          <input
            type="text"
            inputMode="decimal"
            defaultValue={e.amount.toFixed(2)}
            onBlur={(ev) => {
              const v = parseAmount(ev.target.value)
              ev.target.value = v.toFixed(2)
              if (v !== e.amount) onSave(e, { amount: v })
            }}
            className={inputCls + ' text-right ' + (isIncome ? 'text-green-700' : 'text-red-600')}
          />
        </div>
      </div>
      <input
        type="text"
        defaultValue={e.description ?? ''}
        placeholder="说明…"
        onBlur={(ev) => {
          const v = ev.target.value || null
          if (v !== e.description) onSave(e, { description: v })
        }}
        className={inputCls + ' mt-2'}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select
          defaultValue={e.category ?? ''}
          onChange={(ev) => onSave(e, { category: ev.target.value || null })}
          className={inputCls}
        >
          <option value="">（未分类）</option>
          {config.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => onCopy(e)} className="text-xs text-blue-600 hover:text-blue-800">
            复制到下月
          </button>
          <button
            onClick={() => onRemove(e.id)}
            className="text-xs text-slate-400 hover:text-red-600"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- 电脑/打印表格行 ----
function EntryRow({
  entry: e,
  showCheck,
  onSave,
  onToggle,
  onCopy,
  onRemove,
}: {
  entry: Entry
  showCheck: boolean
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onToggle: (e: Entry) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const isIncome = e.zone === 'income'
  return (
    <tr className={'border-b border-slate-100 ' + (showCheck && e.settled ? 'bg-green-50' : '')}>
      {showCheck && (
        <td className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            checked={e.settled}
            onChange={() => onToggle(e)}
            className="h-4 w-4 cursor-pointer"
            title="打勾表示这笔已按规划实现"
          />
        </td>
      )}
      <td className="px-2 py-1.5">
        <input
          type="date"
          defaultValue={e.entry_date ?? ''}
          onBlur={(ev) => {
            const v = ev.target.value || null
            if (v !== e.entry_date) onSave(e, { entry_date: v })
          }}
          className="w-36 rounded border border-transparent px-1 py-1 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          defaultValue={e.description ?? ''}
          placeholder="点这里写说明…"
          onBlur={(ev) => {
            const v = ev.target.value || null
            if (v !== e.description) onSave(e, { description: v })
          }}
          className="w-full min-w-[140px] rounded border border-transparent px-1 py-1 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          defaultValue={e.category ?? ''}
          onChange={(ev) => onSave(e, { category: ev.target.value || null })}
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
      <td className="px-2 py-1.5 text-right">
        {isIncome ? (
          <input
            type="text"
            inputMode="decimal"
            defaultValue={e.amount.toFixed(2)}
            onBlur={(ev) => {
              const v = parseAmount(ev.target.value)
              ev.target.value = v.toFixed(2)
              if (v !== e.amount) onSave(e, { amount: v })
            }}
            className="w-24 rounded border border-transparent px-1 py-1 text-right text-green-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
          />
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right">
        {!isIncome ? (
          <input
            type="text"
            inputMode="decimal"
            defaultValue={e.amount.toFixed(2)}
            onBlur={(ev) => {
              const v = parseAmount(ev.target.value)
              ev.target.value = v.toFixed(2)
              if (v !== e.amount) onSave(e, { amount: v })
            }}
            className="w-24 rounded border border-transparent px-1 py-1 text-right text-red-600 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
          />
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="no-print px-2 py-1.5 text-right whitespace-nowrap">
        <button onClick={() => onCopy(e)} className="mr-3 text-xs text-blue-600 hover:text-blue-800">
          复制到下月
        </button>
        <button onClick={() => onRemove(e.id)} className="text-xs text-slate-400 hover:text-red-600">
          ✕
        </button>
      </td>
    </tr>
  )
}

// ============================================================================
// 添加一笔（规划 / 意外通用）
// ============================================================================
function AddForm({
  title,
  unexpected,
  monthId,
  onAdded,
  onError,
}: {
  title: string
  unexpected: boolean
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
        is_unexpected: unexpected,
        // 意外项默认就算“已发生”；规划项默认未实现，等真发生了再打勾
        settled: unexpected ? true : false,
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
    <div className="no-print rounded-xl bg-white p-4 shadow-sm">
      <h3 className="mb-3 font-semibold text-slate-700">{title}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={onKey}
          placeholder="说明（例如：卖货收入 / 买原料）"
          className={inputCls + ' sm:col-span-2'}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onKeyDown={onKey}
          className={inputCls}
        />
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
          type="text"
          inputMode="decimal"
          value={income}
          onChange={(e) => setIncome(e.target.value)}
          onKeyDown={onKey}
          placeholder="收入金额"
          className={inputCls + ' text-right text-green-700'}
        />
        <input
          type="text"
          inputMode="decimal"
          value={expense}
          onChange={(e) => setExpense(e.target.value)}
          onKeyDown={onKey}
          placeholder="支出金额"
          className={inputCls + ' text-right text-red-600'}
        />
        <button
          onClick={add}
          disabled={busy}
          className="w-full rounded-md bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:col-span-2"
        >
          ＋ 添加{unexpected ? '意外项' : '规划项'}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        收入填「收入金额」，支出填「支出金额」（两个只填一个）。填完点添加或按回车。
      </p>
    </div>
  )
}
