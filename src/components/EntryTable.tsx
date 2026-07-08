// ============================================================================
// 文件摘要（EntryTable.tsx）
// ----------------------------------------------------------------------------
// 一个“区块”的可编辑表格（收入 / 支出 / 突发 各用一个）。
// 每一行的日期、金额、说明、备注都能直接点进去改，鼠标一离开就自动保存。
//   · 收入区块：多一个“把握度”下拉（已确认/很可能/暂定）
//   · 支出区块：多一个“分类”下拉
//   · 每行右边有“删一行”（软删除，可在设置页恢复）
//   · 底部有“加一行”按钮
//
// 所有存/删都走 store.ts。任何一步出错都会把错误往上抛给页面显示。
// ============================================================================

import { useState } from 'react'
import * as store from '../lib/store'
import type { Confidence, Entry, Zone } from '../types'
import { config } from '../config'
import { parseAmount, formatMoney } from '../lib/money'

interface Props {
  zone: Zone // 这个表格是哪个区块
  monthId: string // 属于哪个月
  entries: Entry[] // 这个区块当前的行（已排除软删除）
  onChanged: () => void // 存/删/加之后，通知页面重新加载
  onError: (msg: string) => void // 出错时汇报给页面
}

// 把握度的中文选项
const CONFIDENCE_OPTIONS: { value: Confidence; label: string }[] = [
  { value: 'Confirmed', label: '已确认' },
  { value: 'Likely', label: '很可能' },
  { value: 'Tentative', label: '暂定' },
]

export function EntryTable({ zone, monthId, entries, onChanged, onError }: Props) {
  // 记录哪一行正在保存（显示小小的“保存中”提示）
  const [savingId, setSavingId] = useState<string | null>(null)

  // 保存某一行的某个字段
  async function saveField(entry: Entry, patch: Partial<Entry>) {
    setSavingId(entry.id)
    try {
      await store.saveEntry({
        id: entry.id,
        month_id: entry.month_id,
        zone: entry.zone,
        entry_date: patch.entry_date !== undefined ? patch.entry_date : entry.entry_date,
        amount: patch.amount !== undefined ? patch.amount : entry.amount,
        category: patch.category !== undefined ? patch.category : entry.category,
        description:
          patch.description !== undefined ? patch.description : entry.description,
        confidence: patch.confidence !== undefined ? patch.confidence : entry.confidence,
        settled: patch.settled !== undefined ? patch.settled : entry.settled,
        note: patch.note !== undefined ? patch.note : entry.note,
      })
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  // 加一行：往数据库塞一条空白行，然后重新加载
  async function addRow() {
    try {
      await store.saveEntry({
        month_id: monthId,
        zone,
        amount: 0,
        // 收入行默认给“很可能”，其它区块不需要把握度
        confidence: zone === 'income' ? 'Likely' : null,
        // 支出行默认给分类清单第一项
        category: zone === 'expense' ? config.categories[0] ?? null : null,
      })
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  // 删一行：软删除（is_deleted=true），数据还在，可恢复
  async function removeRow(entry: Entry) {
    try {
      await store.deleteEntry(entry.id)
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  // 这个区块的小计（给人一眼看到总数）
  const subtotal = entries.reduce((sum, e) => sum + e.amount, 0)

  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="px-2 py-2">日期</th>
            <th className="px-2 py-2 text-right">金额</th>
            {zone === 'expense' && <th className="px-2 py-2">分类</th>}
            {zone === 'income' && <th className="px-2 py-2">把握度</th>}
            <th className="px-2 py-2">说明</th>
            <th className="px-2 py-2">备注</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={7} className="px-2 py-4 text-center text-slate-400">
                （还没有记录，点下面「加一行」）
              </td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-slate-100">
              {/* 日期 */}
              <td className="px-2 py-1.5">
                <input
                  type="date"
                  defaultValue={e.entry_date ?? ''}
                  onBlur={(ev) => {
                    const v = ev.target.value || null
                    if (v !== e.entry_date) saveField(e, { entry_date: v })
                  }}
                  className="w-36 rounded border border-transparent px-1 py-0.5 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                />
              </td>

              {/* 金额（离开焦点时解析成两位小数再存） */}
              <td className="px-2 py-1.5 text-right">
                <input
                  type="text"
                  inputMode="decimal"
                  defaultValue={e.amount.toFixed(2)}
                  onBlur={(ev) => {
                    const v = parseAmount(ev.target.value)
                    ev.target.value = v.toFixed(2) // 存完把显示也规整成两位小数
                    if (v !== e.amount) saveField(e, { amount: v })
                  }}
                  className="w-28 rounded border border-transparent px-1 py-0.5 text-right hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                />
              </td>

              {/* 支出：分类下拉 */}
              {zone === 'expense' && (
                <td className="px-2 py-1.5">
                  <select
                    defaultValue={e.category ?? ''}
                    onChange={(ev) => saveField(e, { category: ev.target.value || null })}
                    className="rounded border border-slate-200 px-1 py-0.5 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">（未分类）</option>
                    {config.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
              )}

              {/* 收入：把握度下拉 */}
              {zone === 'income' && (
                <td className="px-2 py-1.5">
                  <select
                    defaultValue={e.confidence ?? 'Likely'}
                    onChange={(ev) =>
                      saveField(e, { confidence: ev.target.value as Confidence })
                    }
                    className="rounded border border-slate-200 px-1 py-0.5 focus:border-blue-500 focus:outline-none"
                  >
                    {CONFIDENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              )}

              {/* 说明 */}
              <td className="px-2 py-1.5">
                <input
                  type="text"
                  defaultValue={e.description ?? ''}
                  placeholder="说明…"
                  onBlur={(ev) => {
                    const v = ev.target.value || null
                    if (v !== e.description) saveField(e, { description: v })
                  }}
                  className="w-full min-w-[120px] rounded border border-transparent px-1 py-0.5 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                />
              </td>

              {/* 备注 */}
              <td className="px-2 py-1.5">
                <input
                  type="text"
                  defaultValue={e.note ?? ''}
                  placeholder="备注…"
                  onBlur={(ev) => {
                    const v = ev.target.value || null
                    if (v !== e.note) saveField(e, { note: v })
                  }}
                  className="w-full min-w-[100px] rounded border border-transparent px-1 py-0.5 hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                />
              </td>

              {/* 删一行 + 保存中提示 */}
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                {savingId === e.id && (
                  <span className="mr-2 text-xs text-slate-400">保存中…</span>
                )}
                <button
                  onClick={() => removeRow(e)}
                  className="text-xs text-red-500 hover:text-red-700"
                  title="删除这一行（软删除，可在设置里恢复）"
                >
                  删一行
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="px-2 py-2 text-xs text-slate-500">小计</td>
            <td className="px-2 py-2 text-right font-semibold text-slate-700">
              {formatMoney(subtotal)}
            </td>
            <td colSpan={5}></td>
          </tr>
        </tfoot>
      </table>

      {/* 加一行 */}
      <button
        onClick={addRow}
        className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600"
      >
        ＋ 加一行
      </button>
    </div>
  )
}
