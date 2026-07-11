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
import type { AppendixRow, CertData, PaymentRow, Subcon, SubconClaim } from '../types'
import { certScopes, company } from '../config'
import { exportCertExcel, exportCertPdf } from '../lib/certExport'
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

// 从分包商主档带出证书资料（新建证书时预填，只留当期金额给人填）
//   dedPrevious：之前各期已付合计（第 2 期起自动填进「6 扣项-已付款」，避免重复付）
function certFromSubcon(sub: Subcon, claimNo: number, dedPrevious: number): CertData {
  const trade = (sub.scopes ?? [])
    .map((s) => s.element)
    .filter(Boolean)
    .join(' & ')
  return {
    subContractor: sub.name,
    trade: trade || undefined,
    projectTitle: sub.project || undefined,
    contractSum: sub.contract_sum || undefined,
    retentionPct: sub.retention_pct ?? 0,
    termOfPayment: sub.term_of_payment || undefined,
    dateCommencement: sub.date_commencement || undefined,
    dateCompletion: sub.date_completion || undefined,
    refLA: sub.ref_la || undefined,
    subconRef: sub.subcon_ref || undefined,
    claimNo,
    dedPrevious: dedPrevious > 0 ? dedPrevious : undefined,
  }
}

// 计算表（照 PDF 的加减逻辑）。retention = 保留金金额（由调用方决定：自动算或手填覆盖）
function compute(d: {
  workdone: number
  vo: number
  advance3: number
  retention: number
  addAdvance: number
  addKsk: number
  addOthers: number
  dedPrevious: number
  dedKsk: number
  dedBackcharge: number
}) {
  const subtotalA = round2(d.workdone + d.vo + d.advance3)
  const retention = round2(d.retention)
  const subtotalB = round2(d.addAdvance + d.addKsk + d.addOthers)
  const nett = round2(subtotalA - retention + subtotalB)
  const dedTotal = round2(d.dedPrevious + d.dedKsk + d.dedBackcharge)
  const totalDue = round2(nett - dedTotal)
  return { subtotalA, retention, subtotalB, nett, totalDue }
}

// 汇总一个 subcon 的“到目前为止”状态（工程量是累计的，取最新一期）
function summarizeSubcon(list: SubconClaim[]) {
  const sorted = [...list].sort((a, b) => a.claim_no - b.claim_no)
  const latest = sorted[sorted.length - 1]
  const prev = sorted[sorted.length - 2]
  const lc = latest?.cert
  const wd = lc?.workdone ?? 0 // 当前累计工程量 = 最新一期封面第 1 项
  const vo = lc?.vo ?? 0
  const adv = lc?.advance3 ?? 0
  // 目前扣着的保留金：有手填就用手填，否则自动按百分比算
  const retentionHeld = lc?.retentionAmount != null ? round2(lc.retentionAmount) : round2(((wd + vo + adv) * (lc?.retentionPct ?? 0)) / 100)
  const paidToDate = round2(sorted.reduce((s, c) => s + (c.gross_amount || 0), 0)) // 累计已付（各期应付之和）
  const thisPeriod = round2(wd - (prev?.cert?.workdone ?? 0)) // 本期新增工程量 = 最新 − 上一期
  return { workdoneToDate: wd, voToDate: vo, retentionHeld, paidToDate, thisPeriod, latestNo: latest?.claim_no ?? 0 }
}

export function Certificate() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [certs, setCerts] = useState<SubconClaim[]>([])
  const [subcons, setSubcons] = useState<Subcon[]>([])
  // 正在打开哪张证书：SubconClaim=编辑现有，'new'=新建，null=看列表
  const [openDoc, setOpenDoc] = useState<SubconClaim | 'new' | null>(null)
  // 新建证书时的预填内容（从分包商主档带出）；空白证书则为 null
  const [prefill, setPrefill] = useState<CertData | null>(null)
  // 是否正在显示「选一个分包商」的选择框
  const [picking, setPicking] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [cs, subs] = await Promise.all([store.getCertificates(), store.getSubcons()])
      setCerts(cs)
      setSubcons(subs)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  // 点某个分包商 → 算出下一期期数 → 预填并打开新证书
  function startFromSubcon(sub: Subcon) {
    const existing = certs.filter((c) => c.subcon === sub.name)
    const nextNo = existing.length ? Math.max(...existing.map((c) => c.claim_no)) + 1 : 1
    // 之前各期已付合计（第 2 期起自动带进「已付款」扣项）
    const prevPaid = round2(existing.reduce((sum, c) => sum + (c.gross_amount || 0), 0))
    const p = certFromSubcon(sub, nextNo, nextNo > 1 ? prevPaid : 0)
    // 继承上一期的附录明细：工程量是累计的，第 2 期在上一期基础上改数量/加新项即可。
    // 封面「工程量/变更单」也按继承来的附录小计预填，保持一致（改数量后点「带入封面」再更新）。
    const latest = existing.slice().sort((a, b) => a.claim_no - b.claim_no).pop()
    const prevAppx = latest?.cert?.appendix
    if (prevAppx && prevAppx.length > 0) {
      p.appendix = prevAppx.map((row) => ({ ...row }))
      p.workdone = round2(
        prevAppx.filter((row) => row.section === 'workdone').reduce((s, row) => s + row.qty * row.rate, 0),
      )
      p.vo = round2(prevAppx.filter((row) => row.section === 'vo').reduce((s, row) => s + row.qty * row.rate, 0))
    }
    setPrefill(p)
    setPicking(false)
    setOpenDoc('new')
  }
  function startBlank() {
    setPrefill(null)
    setPicking(false)
    setOpenDoc('new')
  }

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
        prefill={openDoc === 'new' ? prefill : null}
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
        onClick={() => (subcons.filter((s) => s.active).length > 0 ? setPicking(true) : startBlank())}
        className="w-full rounded-2xl bg-white py-3 text-sm font-medium text-amber-600 shadow-sm hover:bg-amber-50"
      >
        {t('＋ 新建证书', '＋ New certificate')}
      </button>

      {/* 选一个分包商（从主档带出资料）*/}
      {picking && (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700">
              {t('选一个分包商（自动带出资料）', 'Pick a sub-contractor (auto-fill)')}
            </span>
            <button onClick={() => setPicking(false)} className="text-xs text-slate-400 hover:text-slate-600">
              {t('取消', 'Cancel')}
            </button>
          </div>
          <div className="space-y-1.5">
            {subcons
              .filter((s) => s.active)
              .map((s) => {
                const trades = (s.scopes ?? []).map((x) => x.element).filter(Boolean).join('、')
                return (
                  <button
                    key={s.id}
                    onClick={() => startFromSubcon(s)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-amber-400 hover:bg-amber-50"
                  >
                    <span className="truncate text-sm font-medium text-slate-700">{s.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-slate-400">
                      {[trades, s.project].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                )
              })}
          </div>
          <button
            onClick={startBlank}
            className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs text-slate-500 hover:bg-slate-50"
          >
            {t('或：建一张空白证书', 'Or: start a blank certificate')}
          </button>
        </div>
      )}

      {groups.length === 0 && (
        <div className="rounded-2xl bg-white py-8 text-center text-sm text-slate-400 shadow-sm">
          {t('还没有证书，点上面「＋ 新建证书」', 'No certificates yet — tap “＋ New certificate” above')}
        </div>
      )}

      {groups.map((g) => {
        const sm = summarizeSubcon(g.list)
        return (
          <div key={g.subcon} className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-center justify-between bg-slate-100 px-4 py-2 text-sm font-bold text-slate-800">
              <span>🏗 {g.subcon}</span>
              <span className="text-[11px] font-normal text-slate-500">
                {t('已到第', 'Up to claim ')}
                {sm.latestNo}
                {t('期', '')}
              </span>
            </div>

            {/* 汇总条：当前累计工程量 / 累计已付 / 保留金结余 */}
            <div className="grid grid-cols-3 gap-px border-b border-slate-100 bg-slate-100 text-center">
              <div className="bg-white px-2 py-2">
                <div className="text-[10px] text-slate-400">{t('当前累计工程量', 'Work done to date')}</div>
                <div className="text-sm font-bold text-slate-800">RM {fmtAmt(sm.workdoneToDate)}</div>
              </div>
              <div className="bg-white px-2 py-2">
                <div className="text-[10px] text-slate-400">{t('累计已付', 'Paid to date')}</div>
                <div className="text-sm font-bold text-emerald-700">RM {fmtAmt(sm.paidToDate)}</div>
              </div>
              <div className="bg-white px-2 py-2">
                <div className="text-[10px] text-slate-400">{t('保留金结余', 'Retention held')}</div>
                <div className="text-sm font-bold text-amber-700">RM {fmtAmt(sm.retentionHeld)}</div>
              </div>
            </div>

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
                    <div className="text-[11px] text-slate-400">
                      {t('累计工程量', 'Workdone')} RM {fmtAmt(c.cert?.workdone ?? 0)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-emerald-700">RM {fmtAmt(c.gross_amount)}</div>
                    <div className="text-[10px] text-slate-400">{t('本期应付', 'This claim')}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// 一张 A4 证书（可编辑 + 一键列印）
// ============================================================================
function CertDoc({
  claim,
  prefill,
  onClose,
  onSaved,
  onError,
}: {
  claim: SubconClaim | null
  prefill: CertData | null
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const { t } = useI18n()
  // 编辑现有证书用它的 cert；新建时用主档带出的 prefill；都没有就空白
  const c = claim?.cert ?? prefill ?? null

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
    // 保留金覆盖：有值就手动指定保留金金额，空=自动按百分比算
    retentionAmt: c?.retentionAmount != null ? fmtInput(c.retentionAmount) : '',
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
  // 本地错误：保存失败时直接显示在证书顶部（否则错误会被列表页盖住看不到）
  const [errMsg, setErrMsg] = useState('')
  const fail = (m: string) => {
    setErrMsg(m)
    onError(m)
  }
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  const num = (k: string) => parseAmount(f[k])

  // 附录明细草稿：按「固定分类框」组织。数量/单价用字符串（方便输入），金额自动 = 数量 × 单价
  type AppxDraft = { category: string; desc: string; unit: string; qty: string; rate: string }
  // 某分类默认属于封面第几项（找不到就当工程量）
  const groupOf = (category: string): 'workdone' | 'vo' =>
    certScopes.find((s) => s.key === category)?.group ?? 'workdone'
  const catLabel = (category: string) => certScopes.find((s) => s.key === category)?.label ?? category
  const catUnit = (category: string) => certScopes.find((s) => s.key === category)?.unit ?? ''
  // 初始化：把已有明细读进来；再确保每个固定分类框至少有一行（这样一打开就摆好了框）
  const initAppx = (): AppxDraft[] => {
    const rows: AppxDraft[] = (c?.appendix ?? []).map((r) => ({
      category: r.category ?? r.section, // 兼容旧数据（旧行只有 section）
      desc: r.desc,
      unit: r.unit,
      qty: r.qty ? String(round2(r.qty)) : '',
      rate: r.rate ? fmtInput(r.rate) : '',
    }))
    for (const sc of certScopes) {
      if (!rows.some((r) => r.category === sc.key)) {
        rows.push({ category: sc.key, desc: '', unit: sc.unit, qty: '', rate: '' })
      }
    }
    return rows
  }
  const [appx, setAppx] = useState<AppxDraft[]>(initAppx)
  const setRow = (i: number, key: keyof AppxDraft, v: string) =>
    setAppx((p) => p.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)))
  const addRow = (category: string) =>
    setAppx((p) => [...p, { category, desc: '', unit: catUnit(category), qty: '', rate: '' }])
  const removeRow = (i: number) => setAppx((p) => p.filter((_, idx) => idx !== i))
  const rowAmt = (r: AppxDraft) => round2(parseAmount(r.qty) * parseAmount(r.rate))
  // 封面两项小计：所有 workdone 类之和 / 所有 vo 类之和
  const wdSub = round2(
    appx.filter((r) => groupOf(r.category) === 'workdone').reduce((s, r) => s + rowAmt(r), 0),
  )
  const voSub = round2(
    appx.filter((r) => groupOf(r.category) === 'vo').reduce((s, r) => s + rowAmt(r), 0),
  )
  // 有没有“有意义的”附录行（决定要不要出附录页 / 列印第二页）
  const hasAppx = appx.some((r) => r.desc.trim() !== '' || parseAmount(r.qty) !== 0 || parseAmount(r.rate) !== 0)
  // 要显示的分类框顺序：先按 config，再补上数据里有、但 config 没有的（旧/自定义）
  const catOrder: string[] = [
    ...certScopes.map((s) => s.key),
    ...[...new Set(appx.map((r) => r.category))].filter((cat) => !certScopes.some((s) => s.key === cat)),
  ]
  // 某分类的行（带原始下标，方便编辑/删除）
  const catRows = (category: string) =>
    appx.map((r, i) => ({ r, i })).filter((x) => x.r.category === category)
  const catSub = (category: string) =>
    round2(appx.filter((r) => r.category === category).reduce((s, r) => s + rowAmt(r), 0))

  // 付款清单草稿（金额用字符串）
  type PmtDraft = { date: string; cert: string; amount: string; desc: string }
  const [pmtHeader, setPmtHeader] = useState<string>(c?.paymentHeader ?? '')
  const [pmt, setPmt] = useState<PmtDraft[]>(
    (c?.paymentList ?? []).map((p) => ({
      date: p.date,
      cert: p.cert,
      amount: p.amount ? fmtInput(p.amount) : '',
      desc: p.desc,
    })),
  )
  const setPmtRow = (i: number, key: keyof PmtDraft, v: string) =>
    setPmt((p) => p.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)))
  const addPmtRow = () => setPmt((p) => [...p, { date: '', cert: 'ADVANCE', amount: '', desc: '' }])
  const removePmtRow = (i: number) => setPmt((p) => p.filter((_, idx) => idx !== i))
  const pmtTotal = round2(pmt.reduce((s, r) => s + parseAmount(r.amount), 0))
  const hasPmt = pmt.some((r) => r.date.trim() !== '' || parseAmount(r.amount) !== 0 || r.desc.trim() !== '')

  // 保留金：自动 = 小计A × 百分比；若「保留金覆盖」栏(retentionAmt)有填，就用填的
  //   （用于像「预支部分不计保留金」这种，QS 手算的保留金）
  const subtotalA0 = round2(num('workdone') + num('vo') + num('advance3'))
  const autoRetention = round2((subtotalA0 * parseAmount(f.retentionPct)) / 100)
  const retentionUsed = f.retentionAmt.trim() !== '' ? parseAmount(f.retentionAmt) : autoRetention
  const calc = compute({
    workdone: num('workdone'),
    vo: num('vo'),
    advance3: num('advance3'),
    retention: retentionUsed,
    addAdvance: num('addAdvance'),
    addKsk: num('addKsk'),
    addOthers: num('addOthers'),
    dedPrevious: num('dedPrevious'),
    dedKsk: num('dedKsk'),
    dedBackcharge: num('dedBackcharge'),
  })
  const claimNoPad = String(Math.max(1, Math.round(parseAmount(f.claimNo)) || 1)).padStart(2, '0')

  // 把当前草稿组装成 CertData（保存 / 导出共用），附录会过滤掉空行
  function buildCert(): CertData {
    const appendix: AppendixRow[] = appx
      .map((r) => ({
        section: groupOf(r.category),
        category: r.category,
        desc: r.desc.trim(),
        unit: r.unit.trim(),
        qty: parseAmount(r.qty),
        rate: parseAmount(r.rate),
      }))
      .filter((r) => r.desc !== '' || r.qty !== 0 || r.rate !== 0)
    const paymentList: PaymentRow[] = pmt
      .map((r) => ({
        date: r.date.trim(),
        cert: r.cert.trim(),
        amount: parseAmount(r.amount),
        desc: r.desc.trim(),
      }))
      .filter((r) => r.date !== '' || r.amount !== 0 || r.desc !== '')
    return {
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
      retentionAmount: f.retentionAmt.trim() !== '' ? parseAmount(f.retentionAmt) : undefined,
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
      appendix: appendix.length > 0 ? appendix : undefined,
      paymentHeader: pmtHeader || undefined,
      paymentList: paymentList.length > 0 ? paymentList : undefined,
      preparedBy: f.preparedBy || undefined,
      verifiedBy: f.verifiedBy || undefined,
      checkedBy: f.checkedBy || undefined,
      approvedBy: f.approvedBy || undefined,
    }
  }

  async function save() {
    if (!f.subContractor.trim()) {
      fail(t('请填分包商名字（Sub-Contractor）。', 'Please enter the Sub-Contractor name.'))
      return
    }
    setBusy(true)
    setErrMsg('')
    try {
      const cert = buildCert()
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
      fail(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 一键导出：用当前屏幕上的内容（含未保存改动）生成文件
  function doExport(kind: 'pdf' | 'excel') {
    if (!f.subContractor.trim()) {
      fail(t('请先填分包商名字再导出。', 'Please enter the Sub-Contractor name before exporting.'))
      return
    }
    try {
      const payload = { cert: buildCert(), calc, claimNoPad }
      if (kind === 'pdf') exportCertPdf(payload)
      else exportCertExcel(payload)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }
  async function remove() {
    if (!claim) return
    if (!window.confirm(t('确定删除这张证书？', 'Delete this certificate?'))) return
    try {
      await store.deleteCertificate(claim.id)
      onSaved()
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
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
    <div className="min-h-screen bg-slate-200 print:min-h-0 print:bg-white">
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
            onClick={() => doExport('pdf')}
            className="rounded bg-rose-500 px-3 py-1.5 text-sm font-semibold hover:bg-rose-600"
          >
            📄 PDF
          </button>
          <button
            onClick={() => doExport('excel')}
            className="rounded bg-teal-600 px-3 py-1.5 text-sm font-semibold hover:bg-teal-700"
          >
            📊 Excel
          </button>
          <button
            onClick={() => window.print()}
            className="rounded bg-amber-500 px-3 py-1.5 text-sm font-semibold hover:bg-amber-600"
          >
            🖨 {t('列印', 'Print')}
          </button>
        </div>
      </div>

      {/* 保存失败时的错误提示（就地显示，不会被列表页盖住）*/}
      {errMsg && (
        <div className="no-print mx-auto mt-2 max-w-[820px] rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
          ⚠️ {errMsg}
        </div>
      )}

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
            {/* 保留金：默认自动按百分比算；想手填（如预支不计保留金）直接改这格即可 */}
            <span className={numColW + ' text-right font-bold'}>
              <input
                value={f.retentionAmt !== '' ? f.retentionAmt : autoRetention === 0 ? '' : fmtInput(autoRetention)}
                inputMode="decimal"
                placeholder="-"
                onChange={(e) => set('retentionAmt', e.target.value)}
                onBlur={() => {
                  if (f.retentionAmt.trim() !== '') set('retentionAmt', fmtInput(parseAmount(f.retentionAmt)))
                }}
                className="w-full bg-transparent text-right placeholder:text-black focus:bg-amber-50 focus:outline-none"
              />
            </span>
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

      {/* ===== 附录 Appendix：支撑封面的逐项测量（列印时另起一页）===== */}
      <div
        className={
          'cert-doc mx-auto my-4 max-w-[820px] bg-white p-8 text-[12px] leading-tight text-black shadow-lg print:my-0 print:max-w-none print:p-0 print:shadow-none print:break-before-page ' +
          (hasAppx ? '' : 'print:hidden')
        }
      >
        {/* 抬头（与封面一致）*/}
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
        <div className="my-1 border-y border-black py-1 text-center text-[13px] font-bold">
          APPENDIX — DETAIL OF WORKDONE (CLAIM NO. {claimNoPad})
        </div>
        <div className="mb-2 text-[11px] font-bold">
          {[
            f.subContractor,
            f.trade,
            f.projectTitle,
            f.periodEnding ? 'Period: ' + f.periodEnding : '',
          ]
            .filter(Boolean)
            .join('  |  ')}
        </div>

        {/* 表头 */}
        <div className="flex items-center border-b-2 border-black py-1 text-[11px] font-bold">
          <span className="w-7">No</span>
          <span className="flex-1">Description</span>
          <span className="w-14">Unit</span>
          <span className="w-16 text-right">Qty</span>
          <span className="w-24 text-right">Rate (RM)</span>
          <span className="w-28 text-right">Amount (RM)</span>
          <span className="no-print w-6" />
        </div>

        {/* 固定分类框：rebar / formwork / concrete / lean con / BRC / daywork / VO … */}
        {catOrder.map((category) => {
          const rows = catRows(category)
          const isVo = groupOf(category) === 'vo'
          return (
            <div key={category} className="mt-2">
              <div className="flex items-center justify-between border-b border-black py-0.5 text-[11px] font-bold">
                <span>
                  {catLabel(category)}
                  {isVo ? t('（→ 封面 2 变更）', ' (-> front page 2)') : ''}
                </span>
                <span className="text-slate-400">{fmtAmt(catSub(category))}</span>
              </div>
              {rows.length === 0 && (
                <div className="no-print py-1 text-[10px] text-slate-300">
                  {t('这个框还没填，点下面「＋加一行」', 'Empty — click “+ Add row” below')}
                </div>
              )}
              {rows.map((x, j) => (
                <div key={x.i} className="flex items-center border-b border-slate-200 py-0.5">
                  <span className="w-7">{j + 1}</span>
                  <input
                    value={x.r.desc}
                    onChange={(e) => setRow(x.i, 'desc', e.target.value)}
                    placeholder={t('地点/说明（可空）', 'Location/desc (optional)')}
                    className="flex-1 bg-transparent px-1 focus:bg-amber-50 focus:outline-none"
                  />
                  <input
                    value={x.r.unit}
                    onChange={(e) => setRow(x.i, 'unit', e.target.value)}
                    placeholder={t('单位', 'Unit')}
                    className="w-14 bg-transparent px-1 focus:bg-amber-50 focus:outline-none"
                  />
                  <input
                    value={x.r.qty}
                    inputMode="decimal"
                    onChange={(e) => setRow(x.i, 'qty', e.target.value)}
                    placeholder="0"
                    className="w-16 bg-transparent px-1 text-right focus:bg-amber-50 focus:outline-none"
                  />
                  <input
                    value={x.r.rate}
                    inputMode="decimal"
                    onChange={(e) => setRow(x.i, 'rate', e.target.value)}
                    onBlur={() => setRow(x.i, 'rate', fmtInput(parseAmount(x.r.rate)))}
                    placeholder="0"
                    className="w-24 bg-transparent px-1 text-right focus:bg-amber-50 focus:outline-none"
                  />
                  <span className="w-28 px-1 text-right">{fmtAmt(rowAmt(x.r))}</span>
                  <button
                    onClick={() => removeRow(x.i)}
                    className="no-print w-6 text-slate-300 hover:text-red-500"
                    title={t('删除这行', 'Remove')}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => addRow(category)}
                className="no-print mt-0.5 text-[11px] font-medium text-amber-600 hover:underline"
              >
                {t('＋ 加一行（分地点）', '＋ Add row (by location)')}
              </button>
            </div>
          )
        })}

        {/* 两项合计（→ 封面）*/}
        <div className="mt-3 border-t-2 border-black pt-1">
          <div className="flex items-center py-0.5 text-[11px] font-bold">
            <span className="flex-1 pr-2 text-right">
              {t('工程量合计 TOTAL WORKDONE（→ 封面 1）', 'TOTAL WORKDONE (-> front page 1)')}
            </span>
            <span className="w-28 px-1 text-right">{fmtAmt(wdSub)}</span>
            <span className="no-print w-6" />
          </div>
          <div className="flex items-center py-0.5 text-[11px] font-bold">
            <span className="flex-1 pr-2 text-right">
              {t('变更合计 TOTAL VO（→ 封面 2）', 'TOTAL VO (-> front page 2)')}
            </span>
            <span className="w-28 px-1 text-right">{fmtAmt(voSub)}</span>
            <span className="no-print w-6" />
          </div>
        </div>

        {/* 与封面对照 + 一键带入（只在屏幕显示）*/}
        <div className="no-print mt-3 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {t('附录小计', 'Appendix subtotal')}：{t('工程量', 'Workdone')} RM {fmtAmt(wdSub)} · VO RM{' '}
              {fmtAmt(voSub)}
              <br />
              {t('封面填的', 'Front page')}：{t('工程量', 'Workdone')} RM {fmtAmt(num('workdone'))} · VO RM{' '}
              {fmtAmt(num('vo'))}
            </div>
            <button
              onClick={() => {
                set('workdone', fmtInput(wdSub))
                set('vo', fmtInput(voSub))
              }}
              className="rounded-md bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700"
            >
              {t('把小计带入封面', 'Sync to front page')}
            </button>
          </div>
          {hasAppx && (round2(num('workdone')) !== wdSub || round2(num('vo')) !== voSub) && (
            <div className="mt-1 font-semibold text-amber-700">
              ⚠️ {t('附录小计和封面金额不一致，点上面按钮带入。', 'Appendix subtotal differs from front page — click Sync.')}
            </div>
          )}
        </div>
      </div>

      {/* ===== 付款清单 Payment List：支撑封面「已付款」（多用于第一期借支，列印时另起一页）===== */}
      <div
        className={
          'cert-doc mx-auto my-4 max-w-[820px] bg-white p-8 text-[12px] leading-tight text-black shadow-lg print:my-0 print:max-w-none print:p-0 print:shadow-none print:break-before-page ' +
          (hasPmt ? '' : 'print:hidden')
        }
      >
        {/* 顶部项目全名 */}
        <input
          value={pmtHeader}
          onChange={(e) => setPmtHeader(e.target.value)}
          placeholder={t('项目全名（可空）', 'Project full name (optional)')}
          className="w-full bg-transparent text-[12px] font-bold focus:bg-amber-50 focus:outline-none"
        />

        <div className="mt-4 flex items-start justify-between">
          <div className="text-[13px] font-bold underline">PAYMENT LIST</div>
          <div className="text-right text-[12px]">
            <div>Claim : {claimNoPad}</div>
            <div>Period ending : {f.periodEnding}</div>
          </div>
        </div>

        {/* 表格 */}
        <table className="mt-1 w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-center font-bold">
              <th className="w-12 border border-black py-1">NO</th>
              <th className="w-28 border border-black py-1">DATE</th>
              <th className="w-28 border border-black py-1">CERT</th>
              <th className="w-32 border border-black py-1">AMOUNT</th>
              <th className="border border-black py-1">DESCRIPTION</th>
              <th className="no-print w-6 border-0" />
            </tr>
          </thead>
          <tbody>
            {pmt.map((r, i) => (
              <tr key={i}>
                <td className="border border-black text-center">{i + 1}</td>
                <td className="border border-black px-1 text-center">
                  <input
                    value={r.date}
                    onChange={(e) => setPmtRow(i, 'date', e.target.value)}
                    placeholder={t('日期', 'Date')}
                    className="w-full bg-transparent text-center focus:bg-amber-50 focus:outline-none"
                  />
                </td>
                <td className="border border-black px-1 text-center">
                  <input
                    value={r.cert}
                    onChange={(e) => setPmtRow(i, 'cert', e.target.value)}
                    placeholder="ADVANCE"
                    className="w-full bg-transparent text-center focus:bg-amber-50 focus:outline-none"
                  />
                </td>
                <td className="border border-black px-1 text-right">
                  <input
                    value={r.amount}
                    inputMode="decimal"
                    onChange={(e) => setPmtRow(i, 'amount', e.target.value)}
                    onBlur={() => setPmtRow(i, 'amount', fmtInput(parseAmount(r.amount)))}
                    placeholder="0"
                    className="w-full bg-transparent text-right focus:bg-amber-50 focus:outline-none"
                  />
                </td>
                <td className="border border-black px-1">
                  <input
                    value={r.desc}
                    onChange={(e) => setPmtRow(i, 'desc', e.target.value)}
                    className="w-full bg-transparent focus:bg-amber-50 focus:outline-none"
                  />
                </td>
                <td className="no-print border-0 text-center">
                  <button onClick={() => removePmtRow(i)} className="text-slate-300 hover:text-red-500" title={t('删除', 'Remove')}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="border border-black px-1" colSpan={3}>
                TOTAL
              </td>
              <td className="border border-black px-1 text-right">{fmtAmt(pmtTotal)}</td>
              <td className="border border-black" />
              <td className="no-print border-0" />
            </tr>
          </tbody>
        </table>
        <button
          onClick={addPmtRow}
          className="no-print mt-1 text-[11px] font-medium text-amber-600 hover:underline"
        >
          {t('＋ 加一笔付款', '＋ Add payment')}
        </button>
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
