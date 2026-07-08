// ============================================================================
// 文件摘要（Account.tsx）—— 首页「账户」（简单账本）
// ----------------------------------------------------------------------------
// 这是登录后看到的第一个页面，故意做得【超简单】：
//   · 顶部三个大数字：收入、支出、剩余（自动算）
//   · 下面一张表格：日期 | 说明 | 收入 | 支出 | 删
//   · 直接点格子就能填/改，鼠标一离开自动保存
//   · 最下面有一行「快速添加」：填好点「＋添加」就多一行
//
// 说明：为了简单，这里把复杂的“6个月预测/缓冲金”都藏起来了（在设置→高级里）。
// 数据还是走 store.ts；一个账户对应数据库里的一个“月份”，可在顶部切换。
// 第一次进来若一个月份都没有，会自动建一个（当月），省得你手动去建。
// ============================================================================

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import * as store from '../lib/store'
import type { Entry, Month } from '../types'
import { formatMoney, parseAmount, round2, sumAmounts } from '../lib/money'
import { friendlyError } from '../lib/errors'

// 当前年月，例如 "2026-07"，用来给自动新建的账户起名
function currentYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function Account() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [months, setMonths] = useState<Month[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])

  // 加载：拿所有月份；若没有就自动建一个当月账户；再拿当前账户的记录
  async function load(keepId?: string) {
    setLoading(true)
    setError('')
    try {
      let ms = await store.getMonths()
      // 一个都没有 → 自动建一个当月账户，用户不用管
      if (ms.length === 0) {
        await store.addMonth({ label: currentYm(), opening_balance: 0 })
        ms = await store.getMonths()
      }
      setMonths(ms)
      // 选中哪个：优先保留原选择，否则第一个
      const pick = keepId && ms.some((m) => m.id === keepId) ? keepId : ms[0].id
      setSelectedId(pick)
      const es = await store.getEntries(pick)
      setEntries(es)
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

  // 切换账户（月份）时，重新拿那个账户的记录
  async function switchMonth(id: string) {
    setSelectedId(id)
    setError('')
    try {
      setEntries(await store.getEntries(id))
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  // 当前选中的账户对象
  const currentMonth = months.find((m) => m.id === selectedId)

  // 汇总：收入 / 支出 / 剩余
  // 收入 = 收入行合计；支出 = 支出行 + 突发行合计（突发在简单视图里也算支出）
  const income = useMemo(
    () => sumAmounts(entries.filter((e) => e.zone === 'income').map((e) => e.amount)),
    [entries],
  )
  const expense = useMemo(
    () =>
      sumAmounts(
        entries.filter((e) => e.zone === 'expense' || e.zone === 'unexpected').map((e) => e.amount),
      ),
    [entries],
  )
  const opening = round2(currentMonth?.opening_balance ?? 0)
  const remaining = round2(opening + income - expense) // 剩余 = 期初 + 收入 − 支出

  // 保存某一行的某个字段
  async function saveField(entry: Entry, patch: Partial<Entry>) {
    try {
      await store.saveEntry({
        id: entry.id,
        month_id: entry.month_id,
        zone: entry.zone,
        entry_date: patch.entry_date !== undefined ? patch.entry_date : entry.entry_date,
        amount: patch.amount !== undefined ? patch.amount : entry.amount,
        description: patch.description !== undefined ? patch.description : entry.description,
        category: entry.category,
        confidence: entry.confidence,
        settled: entry.settled,
        note: entry.note,
      })
      setEntries(await store.getEntries(selectedId))
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  // 删一行（软删除，可在设置里恢复）
  async function removeRow(id: string) {
    try {
      await store.deleteEntry(id)
      setEntries(await store.getEntries(selectedId))
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  // 改期初余额
  async function saveOpening(value: number) {
    if (!currentMonth) return
    try {
      await store.updateMonth(currentMonth.id, { opening_balance: value })
      setMonths(await store.getMonths())
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>

  return (
    <div className="space-y-5">
      {/* 顶部：账户选择 + 期初余额 */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-slate-500">账户（月份）</div>
          <select
            value={selectedId}
            onChange={(e) => switchMonth(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          >
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">期初余额（这个账户一开始有多少钱）</div>
          <input
            type="text"
            inputMode="decimal"
            defaultValue={opening.toFixed(2)}
            key={selectedId + '-' + opening} // 切换账户时刷新显示
            onBlur={(e) => {
              const v = parseAmount(e.target.value)
              e.target.value = v.toFixed(2)
              if (v !== opening) saveOpening(v)
            }}
            className="w-40 rounded-md border border-slate-300 px-3 py-2 text-right focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* 三个大数字 */}
      <div className="grid grid-cols-3 gap-3">
        <BigStat label="收入" value={income} tone="income" />
        <BigStat label="支出" value={expense} tone="expense" />
        <BigStat label="剩余" value={remaining} tone="remaining" />
      </div>

      {/* 账本表格 */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2.5">日期</th>
              <th className="px-3 py-2.5">说明</th>
              <th className="px-3 py-2.5 text-right text-green-700">收入</th>
              <th className="px-3 py-2.5 text-right text-red-600">支出</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
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
                      className="w-full min-w-[140px] rounded border border-transparent px-1 py-1 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  {/* 收入列：只有收入行能填 */}
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
                        className="w-28 rounded border border-transparent px-1 py-1 text-right text-green-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  {/* 支出列：只有支出/突发行能填 */}
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
                        className="w-28 rounded border border-transparent px-1 py-1 text-right text-red-600 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  {/* 删 */}
                  <td className="px-3 py-1.5 text-right">
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

        {/* 快速添加一行 */}
        <QuickAdd monthId={selectedId} onAdded={() => switchMonth(selectedId)} onError={setError} />
      </div>

      <p className="text-xs text-slate-400">
        小提示：收入填「收入」那列，支出填「支出」那列，剩余会自动算。删掉的行可以在「设置」里恢复。
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
  tone: 'income' | 'expense' | 'remaining'
}) {
  // 颜色：收入绿、支出红、剩余看正负（正蓝负红）
  const color =
    tone === 'income'
      ? 'text-green-600'
      : tone === 'expense'
        ? 'text-red-600'
        : value < 0
          ? 'text-red-600'
          : 'text-blue-600'
  return (
    <div className="rounded-xl bg-white p-4 text-center shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={'mt-1 text-xl font-bold sm:text-2xl ' + color}>{formatMoney(value)}</div>
    </div>
  )
}

// ---- 底部「快速添加一行」----
// 填 日期/说明 + 收入或支出其中一个，点「添加」或按回车就存进去。
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
  const [income, setIncome] = useState('')
  const [expense, setExpense] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    const inc = parseAmount(income)
    const exp = parseAmount(expense)
    // 收入和支出都没填 → 不加
    if (inc === 0 && exp === 0) {
      onError('请在「收入」或「支出」里填一个金额。')
      return
    }
    setBusy(true)
    try {
      // 填了收入就存成收入行；否则存成支出行
      const isIncome = inc > 0
      await store.saveEntry({
        month_id: monthId,
        zone: isIncome ? 'income' : 'expense',
        entry_date: date || null,
        amount: isIncome ? inc : exp,
        description: desc || null,
        confidence: isIncome ? 'Confirmed' : null,
      })
      // 清空输入框，方便接着填下一条
      setDate('')
      setDesc('')
      setIncome('')
      setExpense('')
      onAdded()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 按回车也能添加
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
          className="min-w-[160px] flex-1 rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
        />
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
