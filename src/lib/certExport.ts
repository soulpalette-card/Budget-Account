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
// 用 xlsx-js-style（SheetJS 的带样式分支）：支持合并格/边框/加粗/对齐，
// 这样导出的 Excel 才能排成和证书一样的表格样子。
import * as XLSX from 'xlsx-js-style'
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

// ---- Excel 样式小工具 ----
const MONEY_FMT = '#,##0.00;-#,##0.00;"-"' // 正数千分位、负数带减号、0 显示 "-"（和证书一致）
const thin = { style: 'thin', color: { rgb: 'FF000000' } }
const box = { top: thin, bottom: thin, left: thin, right: thin }
// 用 encode_cell 拿地址；给某格写值 + 样式
function put(ws: XLSX.WorkSheet, r: number, col: number, v: string | number, s?: Record<string, unknown>) {
  const addr = XLSX.utils.encode_cell({ r, c: col })
  const t = typeof v === 'number' ? 'n' : 's'
  ws[addr] = { v, t, ...(s ? { s } : {}) }
}
function mergeCells(ws: XLSX.WorkSheet, r1: number, c1: number, r2: number, c2: number) {
  ;(ws['!merges'] ||= []).push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } })
}

// 组装证书工作簿（封面表 + 附录表），导出/测试共用。
// 封面表排成和证书一样的样子（抬头/标题/信息块/计算表/签名格），附录表是明细表。
export function buildCertWorkbook(data: CertExport): XLSX.WorkBook {
  const { cert: c, calc, claimNoPad } = data
  const rp = round2(c.retentionPct ?? 0)
  const wb = XLSX.utils.book_new()

  // ===================== 封面表 =====================
  const ws: XLSX.WorkSheet = {}
  const LAST = 7 // 用 8 列 A..H
  const bold = { font: { bold: true } }
  const money = { numFmt: MONEY_FMT, alignment: { horizontal: 'right' } }
  const moneyB = { numFmt: MONEY_FMT, alignment: { horizontal: 'right' }, font: { bold: true } }
  const rightWrap = { alignment: { horizontal: 'right', wrapText: true }, font: { sz: 8 } }
  let r = 0

  // 抬头
  put(ws, r, 0, company.name, { font: { bold: true, sz: 14 } })
  mergeCells(ws, r, 0, r, 3)
  put(ws, r, 4, company.address, rightWrap)
  mergeCells(ws, r, 4, r, LAST)
  r++
  put(ws, r, 0, company.regNo, { font: { sz: 9 } })
  mergeCells(ws, r, 0, r, 3)
  put(ws, r, 4, company.phone, { alignment: { horizontal: 'right' }, font: { sz: 8 } })
  mergeCells(ws, r, 4, r, LAST)
  r++
  put(ws, r, 4, company.email, { alignment: { horizontal: 'right' }, font: { sz: 8 } })
  mergeCells(ws, r, 4, r, LAST)
  r++
  // 粗黑线（用一行的下边框模拟）
  for (let col = 0; col <= LAST; col++) put(ws, r, col, '', { border: { bottom: { style: 'medium', color: { rgb: 'FF000000' } } } })
  r++
  // 顶部期间
  put(ws, r, 0, c.claimPeriod ?? '', { font: { sz: 8 } })
  mergeCells(ws, r, 0, r, 3)
  r++
  // 标题
  put(ws, r, 0, `CERTIFICATE OF PAYMENT FOR SUB-CONTRACTOR CLAIM NO. ${claimNoPad}`, {
    font: { bold: true, sz: 12 },
    alignment: { horizontal: 'center' },
    border: { top: thin, bottom: thin },
  })
  for (let col = 1; col <= LAST; col++) put(ws, r, col, '', { border: { top: thin, bottom: thin } })
  mergeCells(ws, r, 0, r, LAST)
  r++

  // 信息块 1
  const info1: [string, string][] = [
    ['Ref of LA', c.refLA ?? ''],
    ['Sub-Contractor Ref', c.subconRef ?? ''],
    ['Date of Commencement', c.dateCommencement ?? ''],
    ['Date of Completion', c.dateCompletion ?? ''],
    ['Project Tile', c.projectTitle ?? ''],
  ]
  for (const [label, value] of info1) {
    put(ws, r, 0, label, bold)
    mergeCells(ws, r, 0, r, 1)
    put(ws, r, 2, ':')
    put(ws, r, 3, value, bold)
    mergeCells(ws, r, 3, r, LAST)
    r++
  }
  for (let col = 0; col <= LAST; col++) put(ws, r, col, '', { border: { bottom: thin } })
  r++

  // 信息块 2
  const info2: [string, string | number][] = [
    ['Sub-Contractor', c.subContractor ?? ''],
    ['Trade', c.trade ?? ''],
    ['Contract Sum', c.contractSum ?? ''],
    ['Limit of Retention', `${rp}%`],
    ['Claim No', c.claimNo ?? ''],
    ['Period Ending', c.periodEnding ?? ''],
    ['Valuation Date', c.valuationDate ?? ''],
    ['Term of Payment', c.termOfPayment ?? ''],
  ]
  for (const [label, value] of info2) {
    put(ws, r, 0, label, bold)
    mergeCells(ws, r, 0, r, 1)
    put(ws, r, 2, ':')
    put(ws, r, 3, value, bold)
    mergeCells(ws, r, 3, r, LAST)
    r++
  }
  for (let col = 0; col <= LAST; col++) put(ws, r, col, '', { border: { bottom: thin } })
  r++

  // 计算表：A=编号 B..F=说明 G="RM" H=金额
  const calcRow = (no: string, desc: string, amount: number | null, o: { bold?: boolean; topline?: boolean } = {}) => {
    if (no) put(ws, r, 0, no, o.bold ? bold : undefined)
    put(ws, r, 1, desc, o.bold ? bold : undefined)
    mergeCells(ws, r, 1, r, 5)
    if (amount !== null) {
      put(ws, r, 6, 'RM', bold)
      put(ws, r, 7, round2(amount), {
        ...(o.bold ? moneyB : money),
        ...(o.topline ? { border: { top: thin } } : {}),
        numFmt: MONEY_FMT,
      })
    }
    r++
  }
  const totalRow = (label: string, amount: number, o: { double?: boolean } = {}) => {
    put(ws, r, 5, label, { font: { bold: true }, alignment: { horizontal: 'right' } })
    put(ws, r, 6, 'RM', bold)
    put(ws, r, 7, round2(amount), {
      numFmt: MONEY_FMT,
      alignment: { horizontal: 'right' },
      font: { bold: true },
      border: o.double ? { top: thin, bottom: { style: 'double', color: { rgb: 'FF000000' } } } : { top: thin },
    })
    r++
  }

  calcRow('1', 'VALUE OF WORKDONE', c.workdone ?? 0, { bold: true })
  calcRow('2', 'ADDITION (Variation Order)', c.vo ?? 0)
  calcRow('3', 'Advance', c.advance3 ?? 0)
  totalRow('SUB TOTAL', calc.subtotalA)
  calcRow('4', 'DEDUCTION', null)
  calcRow('', `Retention Sum ${rp}%`, -calc.retention)
  calcRow('5', 'ADDITION', null)
  calcRow('', 'Advance', c.addAdvance ?? 0)
  calcRow('', 'KSK', c.addKsk ?? 0)
  calcRow('', 'Others', c.addOthers ?? 0)
  totalRow('SUB TOTAL', calc.subtotalB)
  totalRow('NETT AMOUNT :', calc.nett)
  calcRow('6', 'DEDUCTION', null)
  calcRow('', 'Previous Amount Payment', -(c.dedPrevious ?? 0))
  calcRow('', 'KSK', -(c.dedKsk ?? 0))
  calcRow('', 'Backcharge', -(c.dedBackcharge ?? 0))
  put(ws, r, 1, 'TOTAL AMOUNT DUE TO / (OWE FROM) YOU', bold)
  mergeCells(ws, r, 1, r, 4)
  put(ws, r, 5, '', undefined)
  put(ws, r, 6, 'RM', bold)
  put(ws, r, 7, round2(calc.totalDue), {
    numFmt: MONEY_FMT,
    alignment: { horizontal: 'right' },
    font: { bold: true },
    border: { top: thin, bottom: { style: 'double', color: { rgb: 'FF000000' } } },
  })
  r += 2

  // 签名格（2×2 + 右边一大格），用边框画格子
  const sigTop = r
  const sig = (rr: number, col: number, colEnd: number, line1: string, line2 = '') => {
    put(ws, rr, col, line1, { font: { bold: true }, border: box, alignment: { vertical: 'bottom' } })
    for (let cc = col + 1; cc <= colEnd; cc++) put(ws, rr, cc, '', { border: box })
    mergeCells(ws, rr, col, rr + 1, colEnd)
    if (line2) put(ws, rr + 2, col, line2)
  }
  // 左两列（A..C / D..E），两行
  sig(sigTop, 0, 2, `Prepared By: ${c.preparedBy ?? ''}`)
  sig(sigTop, 3, 4, `Verified by: ${c.verifiedBy ?? ''}`)
  sig(sigTop + 2, 0, 2, `Checked by: ${c.checkedBy ?? ''}`, '(Project Manager)')
  sig(sigTop + 2, 3, 4, `Approved by: ${c.approvedBy ?? ''}`, '(Director)')
  // 右边一大格 F..H 跨 4 行
  put(ws, sigTop, 5, 'I hereby, agreed and confirm with the amount stated in this certificate', {
    font: { bold: true, sz: 9 },
    alignment: { wrapText: true, vertical: 'top' },
    border: box,
  })
  for (let cc = 6; cc <= LAST; cc++) put(ws, sigTop, cc, '', { border: box })
  mergeCells(ws, sigTop, 5, sigTop + 3, LAST)
  put(ws, sigTop + 4, 5, c.subContractor ?? '', bold)
  put(ws, sigTop + 5, 5, '(Sub Contractor)')

  ws['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 3 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 5 }, { wch: 14 }]
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r + 8, c: LAST } })
  XLSX.utils.book_append_sheet(wb, ws, 'Certificate')

  // ===================== 附录表 =====================
  const ax: XLSX.WorkSheet = {}
  const AL = 6 // 7 列 A..G
  let ar = 0
  put(ax, ar, 0, company.name, { font: { bold: true, sz: 13 } })
  mergeCells(ax, ar, 0, ar, AL)
  ar++
  put(ax, ar, 0, `APPENDIX — DETAIL OF WORKDONE (CLAIM NO. ${claimNoPad})`, {
    font: { bold: true, sz: 12 },
    alignment: { horizontal: 'center' },
  })
  mergeCells(ax, ar, 0, ar, AL)
  ar++
  put(ax, ar, 0, [c.subContractor, c.trade, c.projectTitle, c.periodEnding ? 'Period: ' + c.periodEnding : ''].filter(Boolean).join('  |  '), { font: { bold: true, sz: 9 } })
  mergeCells(ax, ar, 0, ar, AL)
  ar += 2
  // 表头
  const headStyle = { font: { bold: true }, border: { bottom: { style: 'medium', color: { rgb: 'FF000000' } } } }
  put(ax, ar, 0, 'No', headStyle)
  put(ax, ar, 1, 'Description', headStyle)
  mergeCells(ax, ar, 1, ar, 2)
  put(ax, ar, 3, 'Unit', { ...headStyle, alignment: { horizontal: 'center' } })
  put(ax, ar, 4, 'Qty', { ...headStyle, alignment: { horizontal: 'right' } })
  put(ax, ar, 5, 'Rate (RM)', { ...headStyle, alignment: { horizontal: 'right' } })
  put(ax, ar, 6, 'Amount (RM)', { ...headStyle, alignment: { horizontal: 'right' } })
  ar++

  const appx = c.appendix ?? []
  const drawSection = (title: string, section: 'workdone' | 'vo') => {
    const rows = appx.filter((x) => x.section === section)
    if (rows.length === 0) return 0
    put(ax, ar, 0, title, { font: { bold: true } })
    mergeCells(ax, ar, 0, ar, AL)
    ar++
    let sub = 0
    rows.forEach((row, i) => {
      const amt = rowAmount(row)
      sub += amt
      put(ax, ar, 0, i + 1)
      put(ax, ar, 1, row.desc || '')
      mergeCells(ax, ar, 1, ar, 2)
      put(ax, ar, 3, row.unit || '', { alignment: { horizontal: 'center' } })
      put(ax, ar, 4, n2(row.qty || 0), { alignment: { horizontal: 'right' } })
      put(ax, ar, 5, n2(row.rate || 0), { numFmt: MONEY_FMT, alignment: { horizontal: 'right' } })
      put(ax, ar, 6, amt, { numFmt: MONEY_FMT, alignment: { horizontal: 'right' } })
      ar++
    })
    put(ax, ar, 1, `Subtotal ${section === 'workdone' ? '(-> front page item 1)' : '(-> front page item 2)'}`, {
      font: { bold: true },
    })
    mergeCells(ax, ar, 1, ar, 5)
    put(ax, ar, 6, round2(sub), { numFmt: MONEY_FMT, alignment: { horizontal: 'right' }, font: { bold: true }, border: { top: thin } })
    ar += 2
    return round2(sub)
  }
  drawSection('A. VALUE OF WORKDONE', 'workdone')
  drawSection('B. VARIATION ORDER', 'vo')

  ax['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }]
  ax['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ar + 1, c: AL } })
  XLSX.utils.book_append_sheet(wb, ax, 'Appendix')
  return wb
}
