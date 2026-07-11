// ============================================================================
// 文件摘要（Certificate.tsx）—— 进度证书 / Cert 页
// ----------------------------------------------------------------------------
// 完全照用户给的 PDF 样式，做一张可编辑、可一键列印的 A4「进度付款证书」：
//   顶部公司抬头（名字/注册号/地址/电话/邮箱，从 config.company 读，无 logo）
//   → 标题 → 项目信息 → 分包商/claim 信息 → 计算表(工程/变更/预支/保留金/
//     加项/扣项/本期应付) → 签名栏。金额相关的小计/保留金/净额/应付全自动算。
//
// 页面两层：
//   · 列表：按 subcon 分组，列出每张证书（第几期 + 项目 + 本期应付）
//   · 证书：点开某张 → 整张 A4 证书，字段可直接改，右上「🖨 列印」一键打印
// 数据全公司共享（走 store.ts）。文字中英双语。
// ============================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as store from '../lib/store'
import type { CertData, SubconClaim } from '../types'
import { company } from '../config'
import { parseAmount, round2 } from '../lib/money'
import { friendlyError } from '../lib/errors'
import { useI18n } from '../lib/i18n'

// 金额显示：0 显示 "-"（照 PDF），否则千分位两位小数
function fmtAmt(n: number): string {
  const v = round2(n)
  if (v === 0) return '-'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// 输入框失焦后回填：0/空 → 空（靠 placeholder 显示 "-"）；否则千分位
function fmtInput(n: number): string {
  const v = round2(n)
  return v === 0 ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 计算表（照 PDF 的加减逻辑）
function compute(d: {
  workdone: number
  vo: number
  advance3: number
  retentionPct: number
  addAdvance: number
  addKsk: number
  addOthers: number
  dedPrevious: number
  dedKsk: number
  dedBackcharge: number
}) {
  const subtotalA = round2(d.workdone + d.vo + d.advance3)
  const retention = round2((subtotalA * d.retentionPct) / 100)
  const subtotalB = round2(d.addAdvance + d.addKsk + d.addOthers)
  const nett = round2(subtotalA - retention + subtotalB)
  const dedTotal = round2(d.dedPrevious + d.dedKsk + d.dedBackcharge)
  const totalDue = round2(nett - dedTotal)
  return { subtotalA, retention, subtotalB, nett, totalDue }
}

export function Certificate() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [certs, setCerts] = useState<SubconClaim[]>([])
  // 正在打开哪张证书：SubconClaim=编辑现有，'new'=新建，null=看列表
  const [openDoc, setOpenDoc] = useState<SubconClaim | 'new' | null>(null)

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

  const groups = useMemo(() => {
    const map = new Map<string, SubconClaim[]>()
    for (const c of certs) {
      if (!map.has(c.subcon)) map.set(c.subcon, [])
      map.get(c.subcon)!.push(c)
    }
    for (const list of map.values()) list.sort((a, b) => a.claim_no - b.claim_no)
    return Array.from(map.entries()).map(([subcon, list]) => ({ subcon, list }))
  }, [certs])

  // ---- 打开某张证书：整屏显示 A4 文档 ----
  if (openDoc) {
    return (
      <CertDoc
        claim={openDoc === 'new' ? null : openDoc}
        onClose={() => setOpenDoc(null)}
        onSaved={() => {
          setOpenDoc(null)
          load()
        }}
        onError={setError}
      />
    )
  }

  if (loading)
    return <div className="py-16 text-center text-slate-500">{t('加载中…', 'Loading…')}</div>
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 p-4 shadow-md">
        <div className="text-sm font-semibold text-slate-100">
          📄 {t('进度证书 / Cert', 'Progress Certificates')}
        </div>
        <div className="mt-1 text-xs text-slate-300">
          {t('照公司格式的分包商进度付款证书，可一键列印。', 'Subcon progress-payment certificates, one-click print.')}
        </div>
      </div>

      <button
        onClick={() => setOpenDoc('new')}
        className="w-full rounded-2xl bg-white py-3 text-sm font-medium text-amber-600 shadow-sm hover:bg-amber-50"
      >
        {t('＋ 新建证书', '＋ New certificate')}
      </button>

      {groups.length === 0 && (
        <div className="rounded-2xl bg-white py-8 text-center text-sm text-slate-400 shadow-sm">
          {t('还没有证书，点上面「＋ 新建证书」', 'No certificates yet — tap “＋ New certificate” above')}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.subcon} className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="bg-slate-100 px-4 py-2 text-sm font-bold text-slate-800">🏗 {g.subcon}</div>
          <div className="divide-y divide-slate-100">
            {g.list.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenDoc(c)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-amber-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-700">
                    {t('第', 'Claim ')}
                    {c.claim_no}
                    {t('期', '')}
                    {c.cert?.projectTitle ? ' · ' + c.cert.projectTitle : ''}
                    {c.claim_month ? ' · ' + c.claim_month : ''}
                  </div>
                  <div className="text-[11px] text-slate-400">{t('点开查看 / 列印', 'Open / print')}</div>
                </div>
                <div className="shrink-0 text-right text-sm font-semibold text-emerald-700">
                  RM {fmtAmt(c.gross_amount)}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// 一张 A4 证书（可编辑 + 一键列印）
// ============================================================================
function CertDoc({
  claim,
  onClose,
  onSaved,
  onError,
}: {
  claim: SubconClaim | null
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const { t } = useI18n()
  const c = claim?.cert ?? null

  // 草稿：金额一律用字符串存（方便输入 + 失焦格式化），文字直接字符串
  const initAmt = (n?: number) => fmtInput(n ?? 0)
  const [f, setF] = useState<Record<string, string>>({
    claimPeriod: c?.claimPeriod ?? '',
    refLA: c?.refLA ?? '',
    subconRef: c?.subconRef ?? '',
    dateCommencement: c?.dateCommencement ?? '',
    dateCompletion: c?.dateCompletion ?? '',
    projectTitle: c?.projectTitle ?? '',
    subContractor: c?.subContractor ?? claim?.subcon ?? '',
    trade: c?.trade ?? '',
    contractSum: c?.contractSum ?? '',
    retentionPct: String(c?.retentionPct ?? claim?.retention_pct ?? 5),
    claimNo: String(c?.claimNo ?? claim?.claim_no ?? 1),
    periodEnding: c?.periodEnding ?? '',
    valuationDate: c?.valuationDate ?? '',
    termOfPayment: c?.termOfPayment ?? '45 days',
    workdone: initAmt(c?.workdone),
    vo: initAmt(c?.vo),
    advance3: initAmt(c?.advance3),
    addAdvance: initAmt(c?.addAdvance),
    addKsk: initAmt(c?.addKsk),
    addOthers: initAmt(c?.addOthers),
    dedPrevious: initAmt(c?.dedPrevious),
    dedKsk: initAmt(c?.dedKsk),
    dedBackcharge: initAmt(c?.dedBackcharge),
    preparedBy: c?.preparedBy ?? '',
    verifiedBy: c?.verifiedBy ?? '',
    checkedBy: c?.checkedBy ?? '',
    approvedBy: c?.approvedBy ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  const num = (k: string) => parseAmount(f[k])

  const calc = compute({
    workdone: num('workdone'),
    vo: num('vo'),
    advance3: num('advance3'),
    retentionPct: parseAmount(f.retentionPct),
    addAdvance: num('addAdvance'),
    addKsk: num('addKsk'),
    addOthers: num('addOthers'),
    dedPrevious: num('dedPrevious'),
    dedKsk: num('dedKsk'),
    dedBackcharge: num('dedBackcharge'),
  })
  const claimNoPad = String(Math.max(1, Math.round(parseAmount(f.claimNo)) || 1)).padStart(2, '0')

  async function save() {
    if (!f.subContractor.trim()) {
      onError(t('请填分包商名字（Sub-Contractor）。', 'Please enter the Sub-Contractor name.'))
      return
    }
    setBusy(true)
    try {
      const cert: CertData = {
        claimPeriod: f.claimPeriod || undefined,
        refLA: f.refLA || undefined,
        subconRef: f.subconRef || undefined,
        dateCommencement: f.dateCommencement || undefined,
        dateCompletion: f.dateCompletion || undefined,
        projectTitle: f.projectTitle || undefined,
        subContractor: f.subContractor.trim(),
        trade: f.trade || undefined,
        contractSum: f.contractSum || undefined,
        retentionPct: parseAmount(f.retentionPct),
        claimNo: Math.max(1, Math.round(parseAmount(f.claimNo)) || 1),
        periodEnding: f.periodEnding || undefined,
        valuationDate: f.valuationDate || undefined,
        termOfPayment: f.termOfPayment || undefined,
        workdone: num('workdone'),
        vo: num('vo'),
        advance3: num('advance3'),
        addAdvance: num('addAdvance'),
        addKsk: num('addKsk'),
        addOthers: num('addOthers'),
        dedPrevious: num('dedPrevious'),
        dedKsk: num('dedKsk'),
        dedBackcharge: num('dedBackcharge'),
        preparedBy: f.preparedBy || undefined,
        verifiedBy: f.verifiedBy || undefined,
        checkedBy: f.checkedBy || undefined,
        approvedBy: f.approvedBy || undefined,
      }
      await store.saveCertificate({
        id: claim?.id,
        subcon: cert.subContractor!,
        claim_no: cert.claimNo!,
        claim_month: cert.periodEnding ?? null,
        gross_amount: calc.totalDue,
        retention_pct: cert.retentionPct ?? 0,
        cert,
      })
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!claim) return
    if (!window.confirm(t('确定删除这张证书？', 'Delete this certificate?'))) return
    try {
      await store.deleteCertificate(claim.id)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  // 注意：下面用「函数调用」返回 <input>，不要写成 <T/> 组件，
  // 否则每次输入都会重建组件导致输入框失焦。
  const txt = (k: string, cls = '') => (
    <input
      value={f[k]}
      onChange={(e) => set(k, e.target.value)}
      className={'bg-transparent focus:bg-amber-50 focus:outline-none ' + cls}
    />
  )
  const amt = (k: string) => (
    <input
      value={f[k]}
      inputMode="decimal"
      placeholder="-"
      onChange={(e) => set(k, e.target.value)}
      onBlur={() => set(k, fmtInput(parseAmount(f[k])))}
      className="w-full bg-transparent text-right placeholder:text-black focus:bg-amber-50 focus:outline-none"
    />
  )
  const numColW = 'w-28'

  return (
    <div className="min-h-screen bg-slate-200">
      {/* 工具条（不列印）*/}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 bg-slate-800 px-4 py-2 text-white">
        <button onClick={onClose} className="text-sm">
          ← {t('返回', 'Back')}
        </button>
        <div className="flex items-center gap-2">
          {claim && (
            <button onClick={remove} className="rounded bg-slate-600 px-3 py-1.5 text-sm hover:bg-red-600">
              {t('删除', 'Delete')}
            </button>
          )}
          <button
            onClick={save}
            disabled={busy}
            className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
          >
            💾 {t('保存', 'Save')}
          </button>
          <button
            onClick={() => window.print()}
            className="rounded bg-amber-500 px-3 py-1.5 text-sm font-semibold hover:bg-amber-600"
          >
            🖨 {t('列印', 'Print')}
          </button>
        </div>
      </div>

      {/* ===== A4 证书本体 ===== */}
      <div className="cert-doc mx-auto my-4 max-w-[820px] bg-white p-8 text-[12px] leading-tight text-black shadow-lg print:my-0 print:max-w-none print:p-0 print:shadow-none">
        {/* 抬头 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-extrabold tracking-wide">{company.name}</div>
            <div className="text-[11px]">{company.regNo}</div>
          </div>
          <div className="text-right text-[10px] leading-snug text-slate-700">
            <div>{company.address}</div>
            <div>☎ {company.phone}</div>
            <div>✉ {company.email}</div>
          </div>
        </div>
        <div className="mt-2 border-t-4 border-black" />

        {/* 顶部期间 + 标题 */}
        <div className="mt-1">{txt('claimPeriod', 'w-72 text-[10px]')}</div>
        <div className="my-1 border-y border-black py-1 text-center text-[13px] font-bold">
          CERTIFICATE OF PAYMENT FOR SUB-CONTRACTOR CLAIM NO. {claimNoPad}
        </div>

        {/* 项目信息块 */}
        <div className="mt-2 space-y-0.5">
          {[
            ['Ref of LA', 'refLA'],
            ['Sub-Contractor Ref', 'subconRef'],
            ['Date of Commencement', 'dateCommencement'],
            ['Date of Completion', 'dateCompletion'],
            ['Project Tile', 'projectTitle'],
          ].map(([label, k]) => (
            <div key={k} className="flex">
              <span className="w-52 font-bold">{label}</span>
              <span className="w-3">:</span>
              {txt(k, 'flex-1 font-bold')}
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-black" />

        {/* 分包商 / claim 信息块 */}
        <div className="mt-2 space-y-0.5">
          {[
            ['Sub-Contractor', 'subContractor'],
            ['Trade', 'trade'],
            ['Contract Sum', 'contractSum'],
          ].map(([label, k]) => (
            <div key={k} className="flex">
              <span className="w-52 font-bold">{label}</span>
              <span className="w-3">:</span>
              {txt(k, 'flex-1 font-bold')}
            </div>
          ))}
          <div className="flex">
            <span className="w-52 font-bold">Limit of Retention</span>
            <span className="w-3">:</span>
            <span className="font-bold">{txt('retentionPct', 'w-10 text-right font-bold')}%</span>
          </div>
          {[
            ['Claim No', 'claimNo'],
            ['Period Ending', 'periodEnding'],
            ['Valuation Date', 'valuationDate'],
            ['Term of Payment', 'termOfPayment'],
          ].map(([label, k]) => (
            <div key={k} className="flex">
              <span className="w-52 font-bold">{label}</span>
              <span className="w-3">:</span>
              {txt(k, 'flex-1 font-bold')}
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-black" />

        {/* ===== 计算表 ===== */}
        <div className="mt-3 space-y-1.5">
          <CalcRow no="1" desc="VALUE OF WORKDONE" descBold>
            {amt('workdone')}
          </CalcRow>
          <CalcRow no="2" desc="ADDITION (Variation Order)">
            {amt('vo')}
          </CalcRow>
          <CalcRow no="3" desc="Advance">
            {amt('advance3')}
          </CalcRow>
          <div className="flex items-center justify-end gap-2">
            <span className="font-bold">SUB TOTAL</span>
            <span className="font-bold">RM</span>
            <span className={numColW + ' border-t border-black text-right font-bold'}>
              {fmtAmt(calc.subtotalA)}
            </span>
          </div>

          <CalcRow no="4" desc="DEDUCTION" />
          <div className="flex items-center">
            <span className="w-6" />
            <span className="flex-1 font-bold">Retention Sum {parseAmount(f.retentionPct)}%</span>
            <span className="mr-2 font-bold">RM</span>
            <span className={numColW + ' text-right font-bold'}>{fmtAmt(-calc.retention)}</span>
          </div>

          <CalcRow no="5" desc="ADDITION" />
          <CalcRow desc="Advance" indent>
            {amt('addAdvance')}
          </CalcRow>
          <CalcRow desc="KSK" indent>
            {amt('addKsk')}
          </CalcRow>
          <CalcRow desc="Others" indent>
            {amt('addOthers')}
          </CalcRow>
          <div className="flex items-center justify-end gap-2">
            <span className="font-bold">SUB TOTAL</span>
            <span className="font-bold">RM</span>
            <span className={numColW + ' border-t border-black text-right font-bold'}>
              {fmtAmt(calc.subtotalB)}
            </span>
          </div>

          <div className="flex items-center pt-1">
            <span className="flex-1 pl-6">NETT AMOUNT :</span>
            <span className="mr-2 border-t border-black font-bold">RM</span>
            <span className={numColW + ' border-y border-black text-right font-bold'}>
              {fmtAmt(calc.nett)}
            </span>
          </div>

          <CalcRow no="6" desc="DEDUCTION" />
          <CalcRow desc="Previous Amount Payment" indent>
            {amt('dedPrevious')}
          </CalcRow>
          <CalcRow desc="KSK" indent>
            {amt('dedKsk')}
          </CalcRow>
          <CalcRow desc="Backcharge" indent>
            {amt('dedBackcharge')}
          </CalcRow>
          <div className="flex items-center">
            <span className="flex-1 pl-6 font-bold">TOTAL AMOUNT DUE TO / (OWE FROM) YOU</span>
            <span className="mr-2 border-t border-black font-bold">RM</span>
            <span className={numColW + ' border-y-2 border-black text-right font-bold'}>
              {fmtAmt(calc.totalDue)}
            </span>
          </div>
        </div>

        {/* ===== 签名栏 ===== */}
        <table className="mt-8 w-full border-collapse text-[11px]">
          <tbody>
            <tr>
              <td className="h-24 border border-black align-bottom p-2">
                <div className="font-bold">
                  Prepared By: {txt('preparedBy', 'w-28')}
                </div>
              </td>
              <td className="h-24 border border-black align-bottom p-2">
                <div className="font-bold">
                  Verified by: {txt('verifiedBy', 'w-28')}
                </div>
              </td>
              <td rowSpan={2} className="w-1/3 border border-black align-top p-2">
                <div className="mb-10 font-bold">
                  I hereby, agreed and confirm with the amount stated in this certificate
                </div>
                <div className="font-bold">{f.subContractor}</div>
                <div>(Sub Contractor)</div>
              </td>
            </tr>
            <tr>
              <td className="h-24 border border-black align-bottom p-2">
                <div className="font-bold">
                  Checked by: {txt('checkedBy', 'w-28')}
                </div>
                <div>(Project Manager)</div>
              </td>
              <td className="h-24 border border-black align-bottom p-2">
                <div className="font-bold">
                  Approved by: {txt('approvedBy', 'w-28')}
                </div>
                <div>(Director)</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 计算表通用行：编号 | 描述 | RM | (金额子元素)
function CalcRow({
  no,
  desc,
  descBold,
  indent,
  children,
}: {
  no?: string
  desc: string
  descBold?: boolean
  indent?: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex items-center">
      <span className="w-6 shrink-0 text-right pr-2">{no ?? ''}</span>
      <span className={'flex-1 ' + (indent ? 'pl-0 ' : '') + (descBold ? 'font-bold' : '')}>
        {desc}
      </span>
      {children ? (
        <>
          <span className="mr-2 font-bold">RM</span>
          <span className="w-28 text-right">{children}</span>
        </>
      ) : null}
    </div>
  )
}
