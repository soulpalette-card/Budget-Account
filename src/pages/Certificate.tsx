// ============================================================================
// 文件摘要（Certificate.tsx）—— 进度证书 / Cert 页
// ----------------------------------------------------------------------------
// 给 QS 用：记录每个分包商(subcon)每期的进度款证书(claim)。
// 每期记：第几期、月份、本期金额(未扣保留金)、保留金%。程序自动算：
//   · 本期保留金 = 本期金额 × 保留金%
//   · 本期应付净额 = 本期金额 − 本期保留金
//   · 累计 = 该 subcon 按期次逐期累加的“本期金额”
// 每个 subcon 一张卡，卡顶显示累计金额 / 累计保留金 / 累计应付。
// 数据全公司共享（走 store.ts），全部文字中英双语。
// ============================================================================

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import * as store from '../lib/store'
import type { SubconClaim } from '../types'
import { formatMoney, parseAmount, round2, sumAmounts } from '../lib/money'
import { friendlyError } from '../lib/errors'
import { useI18n } from '../lib/i18n'

// 一期算出来的派生数字
function calcClaim(gross: number, pct: number) {
  const retention = round2((gross * pct) / 100)
  const net = round2(gross - retention)
  return { retention, net }
}

export function Certificate() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [certs, setCerts] = useState<SubconClaim[]>([])
  const [addingSubcon, setAddingSubcon] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setCerts(await store.getCertificates())
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  // 按 subcon 分组，每组按期次排好
  const groups = useMemo(() => {
    const map = new Map<string, SubconClaim[]>()
    for (const c of certs) {
      if (!map.has(c.subcon)) map.set(c.subcon, [])
      map.get(c.subcon)!.push(c)
    }
    for (const list of map.values()) list.sort((a, b) => a.claim_no - b.claim_no)
    return Array.from(map.entries()).map(([subcon, list]) => ({ subcon, list }))
  }, [certs])

  const existingSubcons = groups.map((g) => g.subcon)

  if (loading)
    return <div className="py-16 text-center text-slate-500">{t('加载中…', 'Loading…')}</div>
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* 标题卡 */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 p-4 shadow-md">
        <div className="text-sm font-semibold text-slate-100">
          📄 {t('进度证书 / Cert', 'Progress Certificates')}
        </div>
        <div className="mt-1 text-xs text-slate-300">
          {t('QS 记录每个分包商每期 claim；累计与本期应付自动算。', 'QS record of each subcon’s claims; cumulative & net auto-calculated.')}
        </div>
      </div>

      {/* 新增承包商 */}
      {addingSubcon ? (
        <AddClaimForm
          existingSubcons={existingSubcons}
          onSaved={() => {
            setAddingSubcon(false)
            load()
          }}
          onCancel={() => setAddingSubcon(false)}
          onError={setError}
        />
      ) : (
        <button
          onClick={() => setAddingSubcon(true)}
          className="w-full rounded-2xl bg-white py-3 text-sm font-medium text-amber-600 shadow-sm hover:bg-amber-50"
        >
          {t('＋ 新增承包商 / claim', '＋ New subcon / claim')}
        </button>
      )}

      {groups.length === 0 && !addingSubcon && (
        <div className="rounded-2xl bg-white py-8 text-center text-sm text-slate-400 shadow-sm">
          {t('还没有 Cert 记录，点上面「＋ 新增承包商」', 'No certificates yet — tap “＋ New subcon” above')}
        </div>
      )}

      {/* 每个 subcon 一张卡 */}
      {groups.map((g) => (
        <SubconCard key={g.subcon} subcon={g.subcon} list={g.list} onChanged={load} onError={setError} />
      ))}
    </div>
  )
}

// ---- 一个分包商一张卡 ----
function SubconCard({
  subcon,
  list,
  onChanged,
  onError,
}: {
  subcon: string
  list: SubconClaim[]
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)

  // 汇总
  const sumGross = sumAmounts(list.map((c) => c.gross_amount))
  const sumRet = sumAmounts(list.map((c) => calcClaim(c.gross_amount, c.retention_pct).retention))
  const sumNet = round2(sumGross - sumRet)
  const nextClaimNo = list.length ? Math.max(...list.map((c) => c.claim_no)) + 1 : 1

  // 逐期累计
  let running = 0
  const rows = list.map((c) => {
    running = round2(running + c.gross_amount)
    return { claim: c, cumulative: running }
  })

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {/* 卡头：名字 + 汇总 */}
      <div className="bg-slate-100 px-4 py-2.5">
        <div className="text-sm font-bold text-slate-800">🏗 {subcon}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
          <span>
            {t('累计金额', 'Total')} <b className="text-slate-700">{formatMoney(sumGross)}</b>
          </span>
          <span>
            {t('累计保留金', 'Retention')} <b className="text-amber-700">{formatMoney(sumRet)}</b>
          </span>
          <span>
            {t('累计应付', 'Net payable')} <b className="text-emerald-700">{formatMoney(sumNet)}</b>
          </span>
        </div>
      </div>

      {/* 每期 */}
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <ClaimRow
            key={r.claim.id}
            claim={r.claim}
            cumulative={r.cumulative}
            onChanged={onChanged}
            onError={onError}
          />
        ))}
      </div>

      {/* 加一期 */}
      {adding ? (
        <AddClaimForm
          fixedSubcon={subcon}
          nextClaimNo={nextClaimNo}
          onSaved={() => {
            setAdding(false)
            onChanged()
          }}
          onCancel={() => setAdding(false)}
          onError={onError}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full border-t border-slate-100 py-2.5 text-sm text-amber-600 hover:bg-amber-50"
        >
          {t('＋ 加一期', '＋ Add claim')}
        </button>
      )}
    </div>
  )
}

// ---- 一期：收起显示，点开编辑 ----
function ClaimRow({
  claim: c,
  cumulative,
  onChanged,
  onError,
}: {
  claim: SubconClaim
  cumulative: number
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const { retention, net } = calcClaim(c.gross_amount, c.retention_pct)

  // 编辑草稿
  const [month, setMonth] = useState(c.claim_month ?? '')
  const [gross, setGross] = useState(c.gross_amount.toFixed(2))
  const [pct, setPct] = useState(String(c.retention_pct))
  const [note, setNote] = useState(c.note ?? '')

  function openEdit() {
    setMonth(c.claim_month ?? '')
    setGross(c.gross_amount.toFixed(2))
    setPct(String(c.retention_pct))
    setNote(c.note ?? '')
    setOpen(true)
  }
  async function confirmEdit() {
    try {
      await store.saveCertificate({
        id: c.id,
        subcon: c.subcon,
        claim_no: c.claim_no,
        claim_month: month || null,
        gross_amount: parseAmount(gross),
        retention_pct: parseAmount(pct),
        note: note || null,
      })
      setOpen(false)
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }
  async function remove() {
    if (!window.confirm(t('确定删除这一期 claim？', 'Delete this claim?'))) return
    try {
      await store.deleteCertificate(c.id)
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      {/* 收起态 */}
      <button onClick={() => (open ? setOpen(false) : openEdit())} className="w-full px-4 py-2.5 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-700">
              {t('第', 'Claim ')}
              {c.claim_no}
              {t('期', '')}
              {c.claim_month ? ' · ' + c.claim_month : ''}
            </div>
            <div className="text-[11px] text-slate-400">
              {t('保留金', 'Retention')} {c.retention_pct}% (−{formatMoney(retention)}) ·{' '}
              {t('应付', 'Net')} {formatMoney(net)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold text-red-600">{formatMoney(c.gross_amount)}</div>
            <div className="text-[10px] text-slate-400">
              {t('累计', 'Cum.')} {formatMoney(cumulative)}
            </div>
          </div>
        </div>
      </button>

      {/* 展开编辑 */}
      {open && (
        <div className="space-y-2 border-l-8 border-amber-500 bg-amber-100 px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-slate-500">{t('月份', 'Month')}</span>
              <input
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="2026-07"
                className={ctlCls}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-slate-500">
                {t('本期金额', 'Gross amount')}
              </span>
              <input
                inputMode="decimal"
                value={gross}
                onChange={(e) => setGross(e.target.value)}
                className={ctlCls + ' text-right'}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-slate-500">
                {t('保留金 %', 'Retention %')}
              </span>
              <input
                inputMode="decimal"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                className={ctlCls + ' text-right'}
              />
            </label>
            <div className="rounded-md bg-white px-2 py-1 text-right text-xs">
              <div className="text-slate-500">
                {t('保留金', 'Retention')}{' '}
                <b>{formatMoney(calcClaim(parseAmount(gross), parseAmount(pct)).retention)}</b>
              </div>
              <div className="text-emerald-700">
                {t('应付', 'Net')}{' '}
                <b>{formatMoney(calcClaim(parseAmount(gross), parseAmount(pct)).net)}</b>
              </div>
            </div>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('备注（可选）', 'Note (optional)')}
            className={ctlCls}
          />
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={confirmEdit}
              className="flex-1 rounded-lg bg-emerald-500 py-2 text-sm font-bold text-white hover:bg-emerald-600"
            >
              ✅ {t('确认', 'Confirm')}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-bold text-slate-600 hover:bg-slate-300"
            >
              ❎ {t('取消', 'Cancel')}
            </button>
          </div>
          <div className="text-right">
            <button onClick={remove} className="text-xs text-slate-400 hover:text-red-600">
              {t('删除', 'Delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 新增一期（新承包商 或 现有承包商加一期通用）----
function AddClaimForm({
  fixedSubcon,
  nextClaimNo,
  existingSubcons,
  onSaved,
  onCancel,
  onError,
}: {
  fixedSubcon?: string
  nextClaimNo?: number
  existingSubcons?: string[]
  onSaved: () => void
  onCancel: () => void
  onError: (msg: string) => void
}) {
  const { t } = useI18n()
  const [subcon, setSubcon] = useState(fixedSubcon ?? '')
  const [claimNo, setClaimNo] = useState(String(nextClaimNo ?? 1))
  const [month, setMonth] = useState('')
  const [gross, setGross] = useState('')
  const [pct, setPct] = useState('10') // 保留金常见 10%，可改
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!subcon.trim()) {
      onError(t('请填分包商名称。', 'Please enter a subcon name.'))
      return
    }
    if (parseAmount(gross) <= 0) {
      onError(t('请填本期金额。', 'Please enter the gross amount.'))
      return
    }
    setBusy(true)
    try {
      await store.saveCertificate({
        subcon: subcon.trim(),
        claim_no: Math.max(1, Math.round(parseAmount(claimNo)) || 1),
        claim_month: month || null,
        gross_amount: parseAmount(gross),
        retention_pct: parseAmount(pct),
        note: note || null,
      })
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') save()
  }

  return (
    <div className="space-y-2 rounded-2xl border-l-8 border-amber-500 bg-amber-100 p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-700">
        {fixedSubcon ? t('加一期 claim', 'Add claim') : t('新增承包商 / claim', 'New subcon / claim')}
      </div>
      {!fixedSubcon && (
        <>
          <input
            list="subcon-list"
            value={subcon}
            onChange={(e) => setSubcon(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('分包商名称（如 subcon-ksl）', 'Subcon name')}
            className={ctlCls}
          />
          <datalist id="subcon-list">
            {(existingSubcons ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-slate-500">{t('第几期', 'Claim no.')}</span>
          <input
            inputMode="numeric"
            value={claimNo}
            onChange={(e) => setClaimNo(e.target.value)}
            onKeyDown={onKey}
            className={ctlCls + ' text-right'}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-slate-500">{t('月份', 'Month')}</span>
          <input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            onKeyDown={onKey}
            placeholder="2026-07"
            className={ctlCls}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-slate-500">
            {t('本期金额', 'Gross amount')}
          </span>
          <input
            inputMode="decimal"
            value={gross}
            onChange={(e) => setGross(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('金额', 'Amount')}
            className={ctlCls + ' text-right'}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-slate-500">
            {t('保留金 %', 'Retention %')}
          </span>
          <input
            inputMode="decimal"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            onKeyDown={onKey}
            className={ctlCls + ' text-right'}
          />
        </label>
      </div>
      {/* 实时预览 应付/保留金 */}
      <div className="rounded-md bg-white px-3 py-1.5 text-xs text-slate-600">
        {t('本期保留金', 'Retention')}{' '}
        <b className="text-amber-700">
          {formatMoney(calcClaim(parseAmount(gross), parseAmount(pct)).retention)}
        </b>{' '}
        · {t('本期应付', 'Net payable')}{' '}
        <b className="text-emerald-700">
          {formatMoney(calcClaim(parseAmount(gross), parseAmount(pct)).net)}
        </b>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onKey}
        placeholder={t('备注（可选）', 'Note (optional)')}
        className={ctlCls}
      />
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {t('保存', 'Save')}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-bold text-slate-600 hover:bg-slate-300"
        >
          {t('取消', 'Cancel')}
        </button>
      </div>
    </div>
  )
}

const ctlCls =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none'
