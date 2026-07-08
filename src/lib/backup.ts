// ============================================================================
// 文件摘要（backup.ts）—— 导出 / 导入（数据安全）
// ----------------------------------------------------------------------------
// 让用户能一键把所有数据存成文件（Excel 或 JSON），也能从文件导回来恢复。
// 读数据、写数据都走 store.ts，不直接碰 supabase。
//
// 导出：把 月份 / 记录 / 模板 三样打包。
//   · JSON：一个 .json 文件，结构清晰，最适合“完整备份/恢复”。
//   · Excel：一个 .xlsx，三个工作表，适合给人看或在 Excel 里核对。
//
// 导入（恢复）：读文件 → 先建月份(拿到新 id) → 再建记录(把 month_id 换成新 id)
//   → 再建模板。用“新建”方式插入，不会覆盖你现有数据，是“追加恢复”。
// ============================================================================

import * as XLSX from 'xlsx'
import * as store from './store'
import type { Entry, Month, RecurringTemplate } from '../types'

// 备份文件的整体结构
export interface BackupData {
  exported_at: string
  months: Month[]
  entries: Entry[]
  templates: RecurringTemplate[]
}

// ---- 内部：把当前所有数据收集起来（含软删除的行，恢复时也一并带回）----
async function collectAll(): Promise<BackupData> {
  const [months, entries, templates] = await Promise.all([
    store.getMonths(),
    store.getAllEntries(true), // true = 连软删除的也导出，备份要完整
    store.getTemplates(),
  ])
  return {
    // 注意：这里的时间戳只是记录“导出时刻”，用当前时间即可
    exported_at: new Date().toISOString(),
    months,
    entries,
    templates,
  }
}

// ---- 内部：触发浏览器下载一个文件 ----
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ============================ 导出 JSON ============================
export async function exportJson(): Promise<void> {
  const data = await collectAll()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `unikoyo-backup-${todayStamp()}.json`)
}

// ============================ 导出 Excel ============================
export async function exportExcel(): Promise<void> {
  const data = await collectAll()
  const wb = XLSX.utils.book_new()

  // 三个工作表：月份 / 记录 / 模板
  const wsMonths = XLSX.utils.json_to_sheet(data.months)
  const wsEntries = XLSX.utils.json_to_sheet(data.entries)
  const wsTemplates = XLSX.utils.json_to_sheet(data.templates)

  XLSX.utils.book_append_sheet(wb, wsMonths, 'months')
  XLSX.utils.book_append_sheet(wb, wsEntries, 'entries')
  XLSX.utils.book_append_sheet(wb, wsTemplates, 'recurring_templates')

  // 生成二进制并下载
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, `unikoyo-backup-${todayStamp()}.xlsx`)
}

// ============================ 导入（JSON 或 Excel）============================
// 读一个用户选的文件，解析出 months/entries/templates，然后写回数据库。
// 返回一个统计，方便界面提示“导入了几条”。
export async function importFile(file: File): Promise<{
  months: number
  entries: number
  templates: number
}> {
  const isJson = file.name.toLowerCase().endsWith('.json')
  let parsed: {
    months: Partial<Month>[]
    entries: Partial<Entry>[]
    templates: Partial<RecurringTemplate>[]
  }

  if (isJson) {
    const text = await file.text()
    const data = JSON.parse(text) as BackupData
    parsed = {
      months: data.months ?? [],
      entries: data.entries ?? [],
      templates: data.templates ?? [],
    }
  } else {
    // 当作 Excel 读
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    parsed = {
      months: sheetToJson<Month>(wb, 'months'),
      entries: sheetToJson<Entry>(wb, 'entries'),
      templates: sheetToJson<RecurringTemplate>(wb, 'recurring_templates'),
    }
  }

  // ---- 1) 先建月份，并记住“旧 id → 新 id”的对照表 ----
  const idMap: Record<string, string> = {}
  let monthCount = 0
  for (const m of parsed.months) {
    const created = await store.addMonth({
      label: String(m.label ?? '未命名月份'),
      opening_balance: Number(m.opening_balance ?? 0),
      sort_order: m.sort_order !== undefined ? Number(m.sort_order) : undefined,
    })
    if (m.id) idMap[String(m.id)] = created.id
    monthCount++
  }

  // ---- 2) 再建记录，把 month_id 换成新月份的 id ----
  let entryCount = 0
  for (const e of parsed.entries) {
    const oldMonthId = String(e.month_id ?? '')
    const newMonthId = idMap[oldMonthId]
    if (!newMonthId) continue // 找不到对应月份就跳过这条，避免脏数据
    await store.saveEntry({
      month_id: newMonthId,
      zone: (e.zone as Entry['zone']) ?? 'expense',
      entry_date: (e.entry_date as string) ?? null,
      amount: Number(e.amount ?? 0),
      category: (e.category as string) ?? null,
      description: (e.description as string) ?? null,
      confidence: (e.confidence as Entry['confidence']) ?? null,
      settled: Boolean(e.settled ?? false),
      note: (e.note as string) ?? null,
    })
    entryCount++
  }

  // ---- 3) 最后建模板 ----
  let templateCount = 0
  for (const t of parsed.templates) {
    await store.saveTemplate({
      kind: (t.kind as RecurringTemplate['kind']) ?? 'expense',
      amount: Number(t.amount ?? 0),
      category: (t.category as string) ?? null,
      description: (t.description as string) ?? null,
      day_of_month: t.day_of_month !== undefined ? Number(t.day_of_month) : null,
    })
    templateCount++
  }

  return { months: monthCount, entries: entryCount, templates: templateCount }
}

// ---- 小助手：把 Excel 某个工作表读成一堆对象 ----
function sheetToJson<T>(wb: XLSX.WorkBook, sheetName: string): Partial<T>[] {
  const ws = wb.Sheets[sheetName]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws) as Partial<T>[]
}

// ---- 小助手：文件名里的日期戳，例如 20260708 ----
function todayStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`
}
