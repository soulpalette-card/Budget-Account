// ============================================================================
// 文件摘要（Settings.tsx）—— 设置页
// ----------------------------------------------------------------------------
// 一站式管理：
//   A. 改参数（config）：货币、缓冲金算法、安全线、分类清单等（存到本机浏览器）
//   B. 月份：新增第一个月 / 「新增下个月」（自动带模板、期初=上月实际期末）
//   C. 重复项目模板：增删改（房租、薪资这种每月固定项）
//   D. 导出 / 导入：Excel、JSON 备份与恢复
//   E. 软删除恢复：列出被删的记录，一键恢复
//
// 数据走 store.ts / backup.ts；参数走 config.ts。
// ============================================================================

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { config, saveConfigOverrides, resetConfigOverrides, type BufferMode } from '../config'
import * as store from '../lib/store'
import * as backup from '../lib/backup'
import type { Entry, RecurringTemplate } from '../types'
import { friendlyError } from '../lib/errors'
import { formatMoney } from '../lib/money'

export function Settings() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800">设置</h2>
      <AdvancedLinks />
      <ConfigSection />
      <MonthSection />
      <TemplateSection />
      <BackupSection />
      <RestoreSection />
    </div>
  )
}

// 通用外壳
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-slate-800">{title}</h3>
      {children}
    </div>
  )
}

// ============================ 高级功能入口 ============================
// 简单账本用不到这些，但需要“6个月现金流预测”的人可以从这里进。
function AdvancedLinks() {
  return (
    <Card title="高级功能（需要时才用）">
      <p className="mb-3 text-xs text-slate-400">
        日常记账用「账户」页就够了。下面是给需要做未来现金流预测的人准备的进阶视图。
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          to="/overview"
          className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100"
        >
          📊 6个月总览（计划 vs 实际 + 折线图）
        </Link>
        <Link
          to="/month"
          className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100"
        >
          🗂 每月明细（收入/支出/突发三区 + 缓冲金）
        </Link>
      </div>
    </Card>
  )
}

// ============================ A. 改参数 ============================
function ConfigSection() {
  // 用本地状态承接表单，保存时一次性写回
  const [currency, setCurrency] = useState(config.currency)
  const [bufferMode, setBufferMode] = useState<BufferMode>(config.bufferMode)
  const [bufferValue, setBufferValue] = useState(String(config.bufferValue))
  const [safeThreshold, setSafeThreshold] = useState(String(config.safeThreshold))
  const [rolloverBuffer, setRolloverBuffer] = useState(config.rolloverBuffer)
  const [categoriesText, setCategoriesText] = useState(config.categories.join('\n'))
  const [msg, setMsg] = useState('')

  function handleSave() {
    saveConfigOverrides({
      currency: currency.trim() || 'RM',
      bufferMode,
      bufferValue: Number(bufferValue) || 0,
      safeThreshold: Number(safeThreshold) || 0,
      rolloverBuffer,
      // 分类：一行一个，去掉空行
      categories: categoriesText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    })
    setMsg('已保存！马上刷新页面让新参数生效…')
    // 刷新，让全站用新参数重算
    setTimeout(() => window.location.reload(), 800)
  }

  function handleReset() {
    resetConfigOverrides()
    setMsg('已恢复出厂默认，马上刷新…')
    setTimeout(() => window.location.reload(), 800)
  }

  return (
    <Card title="A. 参数设置">
      <p className="mb-4 text-xs text-slate-400">
        这些改动存在本机浏览器里（换设备/清缓存会回到默认）。想永久改默认值，请直接改代码里的 src/config.ts。
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">货币符号</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">缓冲金算法</span>
          <select
            value={bufferMode}
            onChange={(e) => setBufferMode(e.target.value as BufferMode)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          >
            <option value="fixed">固定金额</option>
            <option value="percent">按预定支出的百分比</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">
            缓冲金数值（固定=金额，百分比=百分数如 10）
          </span>
          <input
            type="number"
            value={bufferValue}
            onChange={(e) => setBufferValue(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">安全线（实际期末低于它就报警赤字）</span>
          <input
            type="number"
            value={safeThreshold}
            onChange={(e) => setSafeThreshold(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={rolloverBuffer}
            onChange={(e) => setRolloverBuffer(e.target.checked)}
          />
          <span className="text-sm text-slate-600">缓冲金结转（没用完的部分下月接着用）</span>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm text-slate-600">分类清单（一行一个）</span>
          <textarea
            value={categoriesText}
            onChange={(e) => setCategoriesText(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
      </div>

      {msg && <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      <div className="mt-4 flex gap-3">
        <button
          onClick={handleSave}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          保存参数
        </button>
        <button
          onClick={handleReset}
          className="rounded-md border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-100"
        >
          恢复出厂默认
        </button>
      </div>
    </Card>
  )
}

// ============================ B. 月份 ============================
function MonthSection() {
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  // 建第一个月（手填期初）
  async function handleAddFirst() {
    if (!label.trim()) {
      setError('请先填月份名字，例如 2026-07')
      return
    }
    setBusy(true)
    setError('')
    setMsg('')
    try {
      await store.addMonth({ label: label.trim(), opening_balance: 0 })
      setMsg(`已新增月份「${label.trim()}」。可去「每月明细」填期初余额和明细。`)
      setLabel('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  // 新增下个月（自动带模板，期初=上月实际期末）
  async function handleAddNext() {
    if (!label.trim()) {
      setError('请填新月份名字，例如 2026-08')
      return
    }
    setBusy(true)
    setError('')
    setMsg('')
    try {
      await store.addNextMonth(label.trim())
      setMsg(`已新增下个月「${label.trim()}」，并自动带入重复模板、期初=上月实际期末。`)
      setLabel('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="B. 月份管理">
      <label className="block max-w-xs">
        <span className="mb-1 block text-sm text-slate-600">新月份名字</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例如 2026-08"
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={handleAddFirst}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          新增一个月（空白）
        </button>
        <button
          onClick={handleAddNext}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          新增下个月（带模板 + 接上月余额）
        </button>
      </div>

      {msg && <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
      {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </Card>
  )
}

// ============================ C. 重复项目模板 ============================
function TemplateSection() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      setTemplates(await store.getTemplates())
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function addBlank() {
    try {
      await store.saveTemplate({ kind: 'expense', amount: 0, category: config.categories[0] })
      load()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function updateField(t: RecurringTemplate, patch: Partial<RecurringTemplate>) {
    try {
      await store.saveTemplate({
        id: t.id,
        kind: patch.kind ?? t.kind,
        amount: patch.amount ?? t.amount,
        category: patch.category !== undefined ? patch.category : t.category,
        description: patch.description !== undefined ? patch.description : t.description,
        day_of_month: patch.day_of_month !== undefined ? patch.day_of_month : t.day_of_month,
      })
      load()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function remove(id: string) {
    try {
      await store.deleteTemplate(id)
      load()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <Card title="C. 重复项目模板">
      <p className="mb-3 text-xs text-slate-400">
        每月固定发生的项目（房租、薪资等）。「新增下个月」时会把这些自动带进新月份。
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="text-slate-500">加载中…</div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-2 py-2">类型</th>
              <th className="px-2 py-2 text-right">金额</th>
              <th className="px-2 py-2">分类</th>
              <th className="px-2 py-2">说明</th>
              <th className="px-2 py-2">每月几号</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-slate-400">
                  还没有模板，点下面「加一个模板」。
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-slate-100">
                <td className="px-2 py-1.5">
                  <select
                    defaultValue={t.kind}
                    onChange={(e) =>
                      updateField(t, { kind: e.target.value as RecurringTemplate['kind'] })
                    }
                    className="rounded border border-slate-200 px-1 py-0.5"
                  >
                    <option value="income">收入</option>
                    <option value="expense">支出</option>
                  </select>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    defaultValue={t.amount}
                    onBlur={(e) => updateField(t, { amount: Number(e.target.value) || 0 })}
                    className="w-24 rounded border border-slate-200 px-1 py-0.5 text-right"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    defaultValue={t.category ?? ''}
                    onChange={(e) => updateField(t, { category: e.target.value || null })}
                    className="rounded border border-slate-200 px-1 py-0.5"
                  >
                    <option value="">（未分类）</option>
                    {config.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    defaultValue={t.description ?? ''}
                    onBlur={(e) => updateField(t, { description: e.target.value || null })}
                    className="w-full min-w-[120px] rounded border border-slate-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={t.day_of_month ?? ''}
                    onBlur={(e) =>
                      updateField(t, {
                        day_of_month: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-16 rounded border border-slate-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => remove(t.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        onClick={addBlank}
        className="mt-3 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600"
      >
        ＋ 加一个模板
      </button>
    </Card>
  )
}

// ============================ D. 导出 / 导入 ============================
function BackupSection() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  async function doExport(kind: 'json' | 'excel') {
    setBusy(true)
    setError('')
    setMsg('')
    try {
      if (kind === 'json') await backup.exportJson()
      else await backup.exportExcel()
      setMsg('已生成备份文件，请查看浏览器下载。')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    setMsg('')
    try {
      const r = await backup.importFile(file)
      setMsg(`导入完成：月份 ${r.months} 个、记录 ${r.entries} 条、模板 ${r.templates} 个。`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
      e.target.value = '' // 清空，方便再次选同一个文件
    }
  }

  return (
    <Card title="D. 导出 / 导入（备份与恢复）">
      <p className="mb-3 text-xs text-slate-400">
        导入是“追加恢复”：会新建月份和记录，不会覆盖你现有数据。建议先导出留底。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => doExport('excel')}
          disabled={busy}
          className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
        >
          导出 Excel
        </button>
        <button
          onClick={() => doExport('json')}
          disabled={busy}
          className="rounded-md bg-slate-700 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
        >
          导出 JSON
        </button>
        <label className="cursor-pointer rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100">
          导入文件（.json 或 .xlsx）
          <input
            type="file"
            accept=".json,.xlsx"
            onChange={handleImport}
            disabled={busy}
            className="hidden"
          />
        </label>
      </div>
      {msg && <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
      {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </Card>
  )
}

// ============================ E. 软删除恢复 ============================
function RestoreSection() {
  const [deleted, setDeleted] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      setDeleted(await store.getDeletedEntries())
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function restore(id: string) {
    try {
      await store.restoreEntry(id)
      load()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  // 区块中文名
  const zoneName: Record<Entry['zone'], string> = {
    income: '收入',
    expense: '支出',
    unexpected: '突发',
  }

  return (
    <Card title="E. 恢复已删除的记录">
      <p className="mb-3 text-xs text-slate-400">
        删除都是“软删除”——数据没真删，都在这里，随时能恢复。
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="text-slate-500">加载中…</div>
      ) : deleted.length === 0 ? (
        <div className="text-slate-400">没有已删除的记录。</div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-2 py-2">区块</th>
              <th className="px-2 py-2 text-right">金额</th>
              <th className="px-2 py-2">分类</th>
              <th className="px-2 py-2">说明</th>
              <th className="px-2 py-2">日期</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {deleted.map((e) => (
              <tr key={e.id} className="border-b border-slate-100">
                <td className="px-2 py-1.5">{zoneName[e.zone]}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(e.amount)}</td>
                <td className="px-2 py-1.5">{e.category ?? '—'}</td>
                <td className="px-2 py-1.5">{e.description ?? '—'}</td>
                <td className="px-2 py-1.5">{e.entry_date ?? '—'}</td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => restore(e.id)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    恢复
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
