// ============================================================================
// 文件摘要（ProjectAccount.tsx）—— 单个项目账（累计总览）
// ----------------------------------------------------------------------------
// 选一个项目，看它从头到现在的：累计收入 / 累计支出 / 净额（收支平衡），
// 外加一个按月份的明细（每个月这个项目收多少、支多少、净多少）。
// 数据全走 store.ts；实际金额沿用账户页的 actualOf 口径（打勾/累计才算实际）。
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import * as store from '../lib/store'
import type { Entry, Month, Project } from '../types'
import { formatMoney, round2, sumAmounts } from '../lib/money'
import { friendlyError } from '../lib/errors'
import { useI18n } from '../lib/i18n'
import { actualOf } from './Account'

export function ProjectAccount() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [months, setMonths] = useState<Month[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [projectId, setProjectId] = useState('')

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const [projs, ms, all] = await Promise.all([
          store.getProjects(),
          store.getMonths(),
          store.getAllEntries(),
        ])
        setProjects(projs)
        setMonths(ms)
        setEntries(all)
        setProjectId((prev) => (prev && projs.some((p) => p.id === prev) ? prev : projs[0]?.id ?? ''))
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // 这个项目的所有记录（未删除）
  const rows = useMemo(
    () => entries.filter((e) => e.project_id === projectId && !e.is_deleted),
    [entries, projectId],
  )

  // 累计（actual 实际口径）
  const incomeActual = sumAmounts(rows.filter((e) => e.zone === 'income').map(actualOf))
  const expenseActual = sumAmounts(rows.filter((e) => e.zone === 'expense').map(actualOf))
  const netActual = round2(incomeActual - expenseActual)
  // 累计（budget 预算口径，只算规划项的预算金额）
  const incomeBudget = sumAmounts(rows.filter((e) => !e.is_unexpected && e.zone === 'income').map((e) => e.amount))
  const expenseBudget = sumAmounts(rows.filter((e) => !e.is_unexpected && e.zone === 'expense').map((e) => e.amount))
  const netBudget = round2(incomeBudget - expenseBudget)

  // 按月份的明细
  const perMonth = useMemo(() => {
    return months
      .map((m) => {
        const mr = rows.filter((e) => e.month_id === m.id)
        const inc = sumAmounts(mr.filter((e) => e.zone === 'income').map(actualOf))
        const exp = sumAmounts(mr.filter((e) => e.zone === 'expense').map(actualOf))
        return { label: m.label, inc, exp, net: round2(inc - exp), count: mr.length }
      })
      .filter((x) => x.count > 0)
  }, [months, rows])

  if (loading) return <div className="py-16 text-center text-slate-500">{t('加载中…', 'Loading…')}</div>
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-16">
      {/* 顶部：选项目 */}
      <div className="no-print flex items-center justify-between gap-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium focus:outline-none"
        >
          {projects.length === 0 && <option value="">{t('（还没有项目）', '(no projects)')}</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.active ? '' : t('（停用）', ' (inactive)')}
            </option>
          ))}
        </select>
        <button onClick={() => window.print()} className="text-slate-500">
          🖨
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl bg-white py-10 text-center text-sm text-slate-400 shadow-sm">
          {t('还没有项目。去「账户」页点「＋ 新增项目」。', 'No projects yet. Add one on the Account page.')}
        </div>
      ) : (
        <>
          {/* 净额大卡 */}
          <div className="rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 p-4 shadow-md">
            <div className="text-sm font-semibold text-slate-100">
              🏗 {projects.find((p) => p.id === projectId)?.name} · {t('累计净额（实际）', 'Net to date (actual)')}
            </div>
            <div className={'text-3xl font-extrabold ' + (netActual < 0 ? 'text-rose-400' : 'text-emerald-400')}>
              {formatMoney(netActual)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-white/10 px-3 py-1.5">
                <div className="text-xs text-slate-300">{t('累计收入', 'Income')}</div>
                <div className="font-bold text-emerald-300">+{formatMoney(incomeActual)}</div>
              </div>
              <div className="rounded-lg bg-white/10 px-3 py-1.5">
                <div className="text-xs text-slate-300">{t('累计支出', 'Expense')}</div>
                <div className="font-bold text-rose-300">-{formatMoney(expenseActual)}</div>
              </div>
            </div>
          </div>

          {/* 预算口径对照 */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500">{t('预算口径（规划）', 'Budget (planned)')}</div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <div className="text-[11px] text-slate-400">{t('预算收入', 'Income')}</div>
                <div className="font-bold text-emerald-600">+{formatMoney(incomeBudget)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">{t('预算支出', 'Expense')}</div>
                <div className="font-bold text-red-600">-{formatMoney(expenseBudget)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">{t('预算净额', 'Net')}</div>
                <div className={'font-bold ' + (netBudget < 0 ? 'text-red-600' : 'text-emerald-600')}>
                  {formatMoney(netBudget)}
                </div>
              </div>
            </div>
          </div>

          {/* 按月份明细 */}
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-1 bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-500">
              <span>{t('月份', 'Month')}</span>
              <span className="text-right">{t('收入', 'Income')}</span>
              <span className="text-right">{t('支出', 'Expense')}</span>
              <span className="text-right">{t('净额', 'Net')}</span>
            </div>
            {perMonth.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400">
                {t('这个项目还没有记录', 'No records for this project yet')}
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {perMonth.map((m) => (
                  <div key={m.label} className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-1 px-3 py-2 text-xs tabular-nums">
                    <span className="text-slate-700">{m.label}</span>
                    <span className="text-right text-emerald-600">+{formatMoney(m.inc)}</span>
                    <span className="text-right text-red-600">-{formatMoney(m.exp)}</span>
                    <span className={'text-right font-semibold ' + (m.net < 0 ? 'text-red-600' : 'text-emerald-600')}>
                      {formatMoney(m.net)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
