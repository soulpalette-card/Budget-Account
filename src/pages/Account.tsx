// ============================================================================
// 文件摘要（Account.tsx）—— 首页「账户」（简单账本，带累计，手机友好）
// ----------------------------------------------------------------------------
// 登录后看到的第一个页面。排版做成【手机优先】，整齐好用：
//   · 顶部四个大数字：收入、支出、本月净、累计余额（自动算）
//   · 手机上：每一笔账是一张整齐的卡片；电脑/打印：是一张整齐的表格
//   · 点格子直接填/改，鼠标一离开（手机是点别处）自动保存
//   · 每笔有「复制到下月」：一键复制到下一个月（只一个月）
//   · 底部「添加一笔」：竖排等宽的格子，填好点添加或按回车
//   · 右上「🖨 列印」：按 A4 纸排版打印（用表格那版）
//
// 【累计】：每个账户（月份）期初 = 上月余额，一路滚动累加。
//          只有第一个月手填期初，后面自动结转。
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

// 根据 "YYYY-MM" 算下一个月的名字；不是这种格式就退而求其次
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

// 一个月的汇总
interface MonthCalc {
  opening: number
  income: number
  expense: number
  net: number
  closing: number
}

// 把所有月份按顺序滚一遍，算每月累计余额
function computeRunning(
  months: Month[],
  byMonth: Record<string, Entry[]>,
): Record<string, MonthCalc> {
  const result: Record<string, MonthCalc> = {}
  let carry: number | null = null
  for (const m of months) {
    const es = byMonth[m.id] ?? []
    const income = sumAmounts(es.filter((e) => e.zone === 'income').map((e) => e.amount))
    const expense = sumAmounts(
      es.filter((e) => e.zone === 'expense' || e.zone === 'unexpected').map((e) => e.amount),
    )
    const opening = carry === null ? round2(m.opening_balance) : carry
    const net = round2(income - expense)
    const closing = round2(opening + net)
    result[m.id] = { opening, income, expense, net, closing }
    carry = closing
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
  const entries = byMonth[selectedId] ?? []
  const calc = calcMap[selectedId] ?? { opening: 0, income: 0, expense: 0, net: 0, closing: 0 }

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
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 打印专用标题（平时隐藏） */}
      <div className="print-only mb-2">
        <h1 className="text-lg font-bold">UNIKOYO 账本 — {currentMonth?.label}</h1>
      </div>

      {/* 顶部工具行：账户选择 +（第一月）期初 + 列印 */}
      <div className="no-print space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-500">账户（月份）</label>
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
            {isFirstMonth ? '期初余额（第一个月，手动填）' : '期初（上月结转，自动）'}
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

      {/* 四个大数字 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BigStat label="收入" value={calc.income} tone="income" />
        <BigStat label="支出" value={calc.expense} tone="expense" />
        <BigStat label="本月净" value={calc.net} tone="net" />
        <BigStat label="累计余额" value={calc.closing} tone="remaining" />
      </div>

      {/* ======= 手机版：卡片列表（窄屏显示，打印时隐藏）======= */}
      <div className="space-y-2 md:hidden print:hidden">
        {entries.length === 0 ? (
          <div className="rounded-xl bg-white p-6 text-center text-slate-400 shadow-sm">
            还没有记录，在下面「添加一笔」填就行 👇
          </div>
        ) : (
          entries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              onSave={saveField}
              onCopy={copyToNext}
              onRemove={removeRow}
            />
          ))
        )}
      </div>

      {/* ======= 电脑/打印版：表格（宽屏或打印时显示）======= */}
      <div className="hidden overflow-x-auto rounded-xl bg-white shadow-sm md:block print:block">
        <table className="w-full border-collapse text-sm">
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
                  还没有记录
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                onSave={saveField}
                onCopy={copyToNext}
                onRemove={removeRow}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* 添加一笔（整齐等宽的表单，打印时隐藏） */}
      <div className="no-print">
        <QuickAdd monthId={selectedId} onAdded={() => load(selectedId)} onError={setError} />
      </div>

      <p className="no-print px-1 text-xs text-slate-400">
        小提示：收入填「收入」、支出填「支出」，累计余额会自动往下个月结转。
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
  let color = 'text-blue-600'
  if (tone === 'income') color = 'text-green-600'
  else if (tone === 'expense') color = 'text-red-600'
  else if (tone === 'net') color = value < 0 ? 'text-red-600' : 'text-green-600'
  else color = value < 0 ? 'text-red-600' : 'text-blue-600'
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm">
      <div className="text-xs text-slate-500 sm:text-sm">{label}</div>
      <div className={'mt-1 text-base font-bold sm:text-2xl ' + color}>{formatMoney(value)}</div>
    </div>
  )
}

// 统一的输入框样式（保证所有格子长得一样）
const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'

// ---- 手机版：一笔账 = 一张卡片（所有格子等宽、整齐）----
function EntryCard({
  entry: e,
  onSave,
  onCopy,
  onRemove,
}: {
  entry: Entry
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const isIncome = e.zone === 'income'
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      {/* 第一排：日期 | 金额（带 收/支 标记，颜色区分） */}
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
            className={
              inputCls + ' text-right ' + (isIncome ? 'text-green-700' : 'text-red-600')
            }
          />
        </div>
      </div>

      {/* 第二排：说明（整行） */}
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

      {/* 第三排：分类 | 操作按钮 */}
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
          <button
            onClick={() => onCopy(e)}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
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

// ---- 电脑/打印版：一笔账 = 表格一行 ----
function EntryRow({
  entry: e,
  onSave,
  onCopy,
  onRemove,
}: {
  entry: Entry
  onSave: (e: Entry, patch: Partial<Entry>) => void
  onCopy: (e: Entry) => void
  onRemove: (id: string) => void
}) {
  const isIncome = e.zone === 'income'
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="px-3 py-1.5">
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
      <td className="px-3 py-1.5">
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
      <td className="px-3 py-1.5">
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
      <td className="px-3 py-1.5 text-right">
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
      <td className="px-3 py-1.5 text-right">
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
      <td className="no-print px-3 py-1.5 text-right whitespace-nowrap">
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

// ---- 底部「添加一笔」：整齐等宽的表单 ----
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
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <h3 className="mb-3 font-semibold text-slate-700">添加一笔</h3>
      {/* 用网格：手机 1 列，电脑 2 列；每个格子都是 w-full，宽度整齐一致 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* 说明占整行 */}
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
          className={inputCls + ' text-right text-green-700 placeholder:text-green-600/50'}
        />
        <input
          type="text"
          inputMode="decimal"
          value={expense}
          onChange={(e) => setExpense(e.target.value)}
          onKeyDown={onKey}
          placeholder="支出金额"
          className={inputCls + ' text-right text-red-600 placeholder:text-red-500/50'}
        />
        <button
          onClick={add}
          disabled={busy}
          className="w-full rounded-md bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:col-span-2"
        >
          ＋ 添加
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        收入填「收入金额」，支出填「支出金额」（两个只填一个）。填完点添加或按回车。
      </p>
    </div>
  )
}
