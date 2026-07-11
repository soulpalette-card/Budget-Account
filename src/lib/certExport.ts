// ============================================================================
// 文件摘要（certExport.ts）—— 证书「一键导出 PDF / Excel」
// ----------------------------------------------------------------------------
// 把一张证书（封面 front page + 附录 appendix）导出成文件：
//   · exportCertPdf ：用 jsPDF 画成矢量 PDF（清晰、体积小，直接下载，无需弹窗）
//   · exportCertExcel：用 xlsx 生成 .xlsx（封面一张表、附录一张表，方便在 Excel 核对）
// 计算好的小计/保留金/净额/应付由页面传进来（和封面显示的完全一致）。
// 不碰数据库，只负责“把内容变成文件下载”。
// ============================================================================

import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import type { AppendixRow, CertData } from '../types'
import { company } from '../config'
import { round2 } from './money'

// 传进来的整包数据：证书内容 + 已算好的金额 + 补零后的期数
export interface CertExport {
  cert: CertData
  calc: {
    subtotalA: number
    retention: number
    subtotalB: number
    nett: number
    totalDue: number
  }
  claimNoPad: string // "01" 这种
}

// 金额格式：0 → "-"（照封面），否则千分位两位小数
function fmt(n: number): string {
  const v = round2(n)
  if (v === 0) return '-'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// 纯数字格式（Excel 里用真数字，不加逗号）
function n2(n: number): number {
  return round2(n)
}
function rowAmount(r: AppendixRow): number {
  return round2((r.qty || 0) * (r.rate || 0))
}

// 文件名里的日期戳，例如 20260711
function stamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
// 文件名里安全的分包商名（去掉奇怪字符）
function safeName(s: string): string {
  return (s || 'subcon').replace(/[^\w一-龥-]+/g, '_').slice(0, 40)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ============================================================================
// 一、导出 PDF（矢量，直接下载）
// ============================================================================
export function exportCertPdf(data: CertExport): void {
  const doc = buildCertPdfDoc(data)
  doc.save(`CERT-${data.claimNoPad}-${safeName(data.cert.subContractor ?? '')}-${stamp()}.pdf`)
}

// 画出证书 PDF（封面 + 附录），返回 jsPDF 文档（导出/测试共用）
export function buildCertPdfDoc(data: CertExport): jsPDF {
  const { cert: c, calc, claimNoPad } = data
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 14 // 左边距
  const R = 196 // 右边距（210-14）
  const AMT_X = R // 金额右对齐到这
  const RM_X = 168 // "RM" 的位置

  // —— 封面 front page ——
  drawHeader(doc)
  let y = 33

  // 顶部期间 + 标题
  doc.setFontSize(8).setFont('helvetica', 'normal')
  if (c.claimPeriod) doc.text(c.claimPeriod, L, y)
  y += 3
  doc.setLineWidth(0.3)
  doc.line(L, y, R, y)
  y += 5
  doc.setFontSize(11).setFont('helvetica', 'bold')
  doc.text(`CERTIFICATE OF PAYMENT FOR SUB-CONTRACTOR CLAIM NO. ${claimNoPad}`, 105, y, {
    align: 'center',
  })
  y += 2
  doc.line(L, y, R, y)
  y += 5

  // 项目信息块
  const info1: [string, string][] = [
    ['Ref of LA', c.refLA ?? ''],
    ['Sub-Contractor Ref', c.subconRef ?? ''],
    ['Date of Commencement', c.dateCommencement ?? ''],
    ['Date of Completion', c.dateCompletion ?? ''],
    ['Project Tile', c.projectTitle ?? ''],
  ]
  y = drawInfo(doc, info1, L, y)
  y += 1
  doc.line(L, y, R, y)
  y += 5

  // 分包商 / claim 信息块
  const info2: [string, string][] = [
    ['Sub-Contractor', c.subContractor ?? ''],
    ['Trade', c.trade ?? ''],
    ['Contract Sum', c.contractSum ?? ''],
    ['Limit of Retention', `${round2(c.retentionPct ?? 0)}%`],
    ['Claim No', String(c.claimNo ?? '')],
    ['Period Ending', c.periodEnding ?? ''],
    ['Valuation Date', c.valuationDate ?? ''],
    ['Term of Payment', c.termOfPayment ?? ''],
  ]
  y = drawInfo(doc, info2, L, y)
  y += 1
  doc.line(L, y, R, y)
  y += 6

  // 计算表
  doc.setFontSize(10)
  const rp = round2(c.retentionPct ?? 0)
  const calcRow = (no: string, desc: string, amount: number | null, opts: { bold?: boolean; indent?: boolean } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    if (no) doc.text(no, L + 2, y)
    doc.text(desc, opts.indent ? L + 8 : L + 8, y)
    if (amount !== null) {
      doc.setFont('helvetica', 'bold')
      doc.text('RM', RM_X, y)
      doc.text(fmt(amount), AMT_X, y, { align: 'right' })
    }
    y += 5.5
  }
  const totalRow = (desc: string, amount: number, opts: { bold?: boolean; topline?: boolean; doubleline?: boolean } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.text(desc, L + 8, y)
    doc.setFont('helvetica', 'bold')
    doc.text('RM', RM_X, y)
    doc.text(fmt(amount), AMT_X, y, { align: 'right' })
    if (opts.topline) doc.line(RM_X + 6, y - 4, AMT_X, y - 4)
    if (opts.doubleline) {
      doc.line(RM_X + 6, y + 1, AMT_X, y + 1)
      doc.line(RM_X + 6, y + 1.8, AMT_X, y + 1.8)
    }
    y += 5.5
  }

  calcRow('1', 'VALUE OF WORKDONE', c.workdone ?? 0, { bold: true })
  calcRow('2', 'ADDITION (Variation Order)', c.vo ?? 0)
  calcRow('3', 'Advance', c.advance3 ?? 0)
  // SUB TOTAL A（右对齐标签）
  doc.setFont('helvetica', 'bold')
  doc.text('SUB TOTAL', RM_X - 22, y)
  doc.text('RM', RM_X, y)
  doc.text(fmt(calc.subtotalA), AMT_X, y, { align: 'right' })
  doc.line(RM_X + 6, y - 4, AMT_X, y - 4)
  y += 6
  calcRow('4', 'DEDUCTION', null)
  calcRow('', `Retention Sum ${rp}%`, -calc.retention, { indent: true })
  calcRow('5', 'ADDITION', null)
  calcRow('', 'Advance', c.addAdvance ?? 0, { indent: true })
  calcRow('', 'KSK', c.addKsk ?? 0, { indent: true })
  calcRow('', 'Others', c.addOthers ?? 0, { indent: true })
  doc.setFont('helvetica', 'bold')
  doc.text('SUB TOTAL', RM_X - 22, y)
  doc.text('RM', RM_X, y)
  doc.text(fmt(calc.subtotalB), AMT_X, y, { align: 'right' })
  doc.line(RM_X + 6, y - 4, AMT_X, y - 4)
  y += 7
  totalRow('NETT AMOUNT :', calc.nett, { topline: true })
  y += 1
  calcRow('6', 'DEDUCTION', null)
  calcRow('', 'Previous Amount Payment', -(c.dedPrevious ?? 0), { indent: true })
  calcRow('', 'KSK', -(c.dedKsk ?? 0), { indent: true })
  calcRow('', 'Backcharge', -(c.dedBackcharge ?? 0), { indent: true })
  totalRow('TOTAL AMOUNT DUE TO / (OWE FROM) YOU', calc.totalDue, { bold: true, topline: true, doubleline: true })

  // 签名栏
  drawSignatures(doc, c, Math.max(y + 6, 232))

  // —— 附录 appendix（若有明细就另起一页）——
  const appx = c.appendix ?? []
  if (appx.length > 0) {
    doc.addPage()
    drawAppendix(doc, data)
  }

  return doc
}

// 公司抬头（封面 + 附录都用）
function drawHeader(doc: jsPDF) {
  doc.setFontSize(13).setFont('helvetica', 'bold')
  doc.text(company.name, 14, 18)
  doc.setFontSize(8).setFont('helvetica', 'normal')
  doc.text(company.regNo, 14, 23)
  doc.setFontSize(7.5)
  doc.text(company.address, 196, 16, { align: 'right' })
  doc.text(company.phone, 196, 20, { align: 'right' })
  doc.text(company.email, 196, 24, { align: 'right' })
  doc.setLineWidth(0.8)
  doc.line(14, 28, 196, 28)
  doc.setLineWidth(0.2)
}

// 一块「标签 : 值」信息，返回结束时的 y
function drawInfo(doc: jsPDF, rows: [string, string][], L: number, startY: number): number {
  let y = startY
  doc.setFontSize(9)
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold')
    doc.text(label, L, y)
    doc.text(':', L + 44, y)
    doc.text(value, L + 48, y)
    y += 4.6
  }
  return y
}

// 签名栏：3 格（左两小格 + 右一大格）
function drawSignatures(doc: jsPDF, c: CertData, top: number) {
  const L = 14
  const colW = 60
  const rightX = L + colW * 2
  const rightW = 196 - rightX
  const rowH = 22
  // 左边两列 × 两行
  doc.setLineWidth(0.2)
  doc.rect(L, top, colW, rowH)
  doc.rect(L + colW, top, colW, rowH)
  doc.rect(L, top + rowH, colW, rowH)
  doc.rect(L + colW, top + rowH, colW, rowH)
  // 右边一大格
  doc.rect(rightX, top, rightW, rowH * 2)

  doc.setFontSize(9).setFont('helvetica', 'bold')
  doc.text(`Prepared By: ${c.preparedBy ?? ''}`, L + 2, top + rowH - 3)
  doc.text(`Verified by: ${c.verifiedBy ?? ''}`, L + colW + 2, top + rowH - 3)
  doc.text(`Checked by: ${c.checkedBy ?? ''}`, L + 2, top + rowH * 2 - 6)
  doc.setFont('helvetica', 'normal').text('(Project Manager)', L + 2, top + rowH * 2 - 2)
  doc.setFont('helvetica', 'bold').text(`Approved by: ${c.approvedBy ?? ''}`, L + colW + 2, top + rowH * 2 - 6)
  doc.setFont('helvetica', 'normal').text('(Director)', L + colW + 2, top + rowH * 2 - 2)

  // 右格
  doc.setFont('helvetica', 'bold').setFontSize(8.5)
  const wrapped = doc.splitTextToSize('I hereby, agreed and confirm with the amount stated in this certificate', rightW - 4)
  doc.text(wrapped, rightX + 2, top + 6)
  doc.setFontSize(9)
  doc.text(c.subContractor ?? '', rightX + 2, top + rowH * 2 - 8)
  doc.setFont('helvetica', 'normal').text('(Sub Contractor)', rightX + 2, top + rowH * 2 - 4)
}

// 附录页：逐项测量明细表
function drawAppendix(doc: jsPDF, data: CertExport) {
  const { cert: c, claimNoPad } = data
  drawHeader(doc)
  const L = 14
  const R = 196
  let y = 34

  doc.setFontSize(11).setFont('helvetica', 'bold')
  doc.text(`APPENDIX — DETAIL OF WORKDONE (CLAIM NO. ${claimNoPad})`, 105, y, { align: 'center' })
  y += 6
  doc.setFontSize(9).setFont('helvetica', 'normal')
  doc.text(
    [c.subContractor, c.trade, c.projectTitle, c.periodEnding ? `Period: ${c.periodEnding}` : '']
      .filter(Boolean)
      .join('  |  '),
    L,
    y,
  )
  y += 5

  // 列位置
  const cNo = L + 1
  const cDesc = L + 12
  const cUnit = 118
  const cQty = 140
  const cRate = 168
  const cAmt = R

  const headerRow = () => {
    doc.setFont('helvetica', 'bold').setFontSize(8.5)
    doc.text('No', cNo, y)
    doc.text('Description', cDesc, y)
    doc.text('Unit', cUnit, y)
    doc.text('Qty', cQty, y, { align: 'right' })
    doc.text('Rate (RM)', cRate, y, { align: 'right' })
    doc.text('Amount (RM)', cAmt, y, { align: 'right' })
    y += 1.5
    doc.setLineWidth(0.3).line(L, y, R, y)
    y += 4
  }
  headerRow()

  doc.setFont('helvetica', 'normal').setFontSize(9)
  const appx = c.appendix ?? []
  const sections: { key: 'workdone' | 'vo'; title: string }[] = [
    { key: 'workdone', title: 'A. VALUE OF WORKDONE' },
    { key: 'vo', title: 'B. VARIATION ORDER' },
  ]

  const pageBottom = 280
  const ensureSpace = () => {
    if (y > pageBottom) {
      doc.addPage()
      drawHeader(doc)
      y = 34
      headerRow()
      doc.setFont('helvetica', 'normal').setFontSize(9)
    }
  }

  for (const sec of sections) {
    const rows = appx.filter((r) => r.section === sec.key)
    if (rows.length === 0) continue
    ensureSpace()
    doc.setFont('helvetica', 'bold')
    doc.text(sec.title, cNo, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    let subtotal = 0
    rows.forEach((r, i) => {
      ensureSpace()
      const amt = rowAmount(r)
      subtotal += amt
      doc.text(String(i + 1), cNo, y)
      const desc = doc.splitTextToSize(r.desc || '', cUnit - cDesc - 3)
      doc.text(desc, cDesc, y)
      doc.text(r.unit || '', cUnit, y)
      doc.text(r.qty ? String(round2(r.qty)) : '', cQty, y, { align: 'right' })
      doc.text(r.rate ? fmt(r.rate) : '', cRate, y, { align: 'right' })
      doc.text(fmt(amt), cAmt, y, { align: 'right' })
      y += Math.max(5, desc.length * 4.2)
    })
    // 小计
    doc.setLineWidth(0.2).line(cRate - 6, y - 3.5, cAmt, y - 3.5)
    doc.setFont('helvetica', 'bold')
    doc.text(`Subtotal ${sec.title.startsWith('A') ? '(-> front page item 1)' : '(-> front page item 2)'}`, cDesc, y)
    doc.text(fmt(round2(subtotal)), cAmt, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 8
  }
}

// ============================================================================
// 二、导出 Excel（.xlsx）
// ============================================================================
export function exportCertExcel(data: CertExport): void {
  const wb = buildCertWorkbook(data)
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, `CERT-${data.claimNoPad}-${safeName(data.cert.subContractor ?? '')}-${stamp()}.xlsx`)
}

// 组装证书工作簿（封面表 + 附录表），导出/测试共用
export function buildCertWorkbook(data: CertExport): XLSX.WorkBook {
  const { cert: c, calc, claimNoPad } = data
  const rp = round2(c.retentionPct ?? 0)
  const wb = XLSX.utils.book_new()

  // —— 封面表：字段 | 值 ——
  const frontRows: (string | number)[][] = [
    [company.name],
    [company.regNo],
    [`CERTIFICATE OF PAYMENT FOR SUB-CONTRACTOR CLAIM NO. ${claimNoPad}`],
    [c.claimPeriod ?? ''],
    [],
    ['Ref of LA', c.refLA ?? ''],
    ['Sub-Contractor Ref', c.subconRef ?? ''],
    ['Date of Commencement', c.dateCommencement ?? ''],
    ['Date of Completion', c.dateCompletion ?? ''],
    ['Project Tile', c.projectTitle ?? ''],
    ['Sub-Contractor', c.subContractor ?? ''],
    ['Trade', c.trade ?? ''],
    ['Contract Sum', c.contractSum ?? ''],
    ['Limit of Retention (%)', rp],
    ['Claim No', c.claimNo ?? ''],
    ['Period Ending', c.periodEnding ?? ''],
    ['Valuation Date', c.valuationDate ?? ''],
    ['Term of Payment', c.termOfPayment ?? ''],
    [],
    ['1  VALUE OF WORKDONE', n2(c.workdone ?? 0)],
    ['2  ADDITION (Variation Order)', n2(c.vo ?? 0)],
    ['3  Advance', n2(c.advance3 ?? 0)],
    ['SUB TOTAL', n2(calc.subtotalA)],
    [`4  DEDUCTION  Retention ${rp}%`, -n2(calc.retention)],
    ['5  ADDITION  Advance', n2(c.addAdvance ?? 0)],
    ['   ADDITION  KSK', n2(c.addKsk ?? 0)],
    ['   ADDITION  Others', n2(c.addOthers ?? 0)],
    ['SUB TOTAL', n2(calc.subtotalB)],
    ['NETT AMOUNT', n2(calc.nett)],
    ['6  DEDUCTION  Previous Amount Payment', -n2(c.dedPrevious ?? 0)],
    ['   DEDUCTION  KSK', -n2(c.dedKsk ?? 0)],
    ['   DEDUCTION  Backcharge', -n2(c.dedBackcharge ?? 0)],
    ['TOTAL AMOUNT DUE TO / (OWE FROM) YOU', n2(calc.totalDue)],
    [],
    ['Prepared By', c.preparedBy ?? ''],
    ['Verified by', c.verifiedBy ?? ''],
    ['Checked by (Project Manager)', c.checkedBy ?? ''],
    ['Approved by (Director)', c.approvedBy ?? ''],
  ]
  const wsFront = XLSX.utils.aoa_to_sheet(frontRows)
  wsFront['!cols'] = [{ wch: 40 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, wsFront, 'Certificate')

  // —— 附录表：明细行 ——
  const appx = c.appendix ?? []
  const apxRows: (string | number)[][] = [['No', 'Section', 'Description', 'Unit', 'Qty', 'Rate (RM)', 'Amount (RM)']]
  let wdSub = 0
  let voSub = 0
  appx
    .filter((r) => r.section === 'workdone')
    .forEach((r, i) => {
      const amt = rowAmount(r)
      wdSub += amt
      apxRows.push([i + 1, 'WORKDONE', r.desc || '', r.unit || '', n2(r.qty || 0), n2(r.rate || 0), amt])
    })
  if (wdSub > 0) apxRows.push(['', '', 'Subtotal WORKDONE (→ item 1)', '', '', '', n2(wdSub)])
  appx
    .filter((r) => r.section === 'vo')
    .forEach((r, i) => {
      const amt = rowAmount(r)
      voSub += amt
      apxRows.push([i + 1, 'VO', r.desc || '', r.unit || '', n2(r.qty || 0), n2(r.rate || 0), amt])
    })
  if (voSub > 0) apxRows.push(['', '', 'Subtotal VO (→ item 2)', '', '', '', n2(voSub)])
  const wsApx = XLSX.utils.aoa_to_sheet(apxRows)
  wsApx['!cols'] = [{ wch: 5 }, { wch: 10 }, { wch: 44 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, wsApx, 'Appendix')
  return wb
}
