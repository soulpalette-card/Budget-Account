// ============================================================================
// 文件摘要（Subcons.tsx）—— 分包商主档 / Subcon 页
// ----------------------------------------------------------------------------
// 出证书之前，先在这里把每个分包商(subcon)的基本资料建好：
//   名字、公司/个人、注册号或身份证/护照、联系人/电话/email/地址、
//   项目、负责工种+价位(可多行)、合同额、保留金%、开工/完工日、付款期、
//   银行户口(银行/户口号/户名)、Ref of LA / Sub-Con Ref、状态、备注。
// 出证书时(证书页「新建」)就能直接选一个 subcon，把这些资料一键带出来。
//
// 页面两层：
//   · 列表：每个 subcon 一张卡（名字 + 工种 + 项目 + 状态）
//   · 表单：点开某个 → 整表可编辑，✅保存 / 删除 / 返回
// 数据全公司共享（走 store.ts）。文字中英双语。
// ============================================================================

import { useEffect, useState } from 'react'
import * as store from '../lib/store'
import type { ScopeLine, Subcon } from '../types'
import { parseAmount, round2 } from '../lib/money'
import { friendlyError } from '../lib/errors'
import { useI18n } from '../lib/i18n'

// 价位显示：0 → 空，否则千分位两位小数
function fmtRate(n: number): string {
  const v = round2(n)
  return v === 0 ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function Subcons() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [subcons, setSubcons] = useState<Subcon[]>([])
  // 正在编辑谁：Subcon=改现有，'new'=新增，null=看列表
  const [editing, setEditing] = useState<Subcon | 'new' | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setSubcons(await store.getSubcons())
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  if (editing) {
    return (
      <SubconForm
        subcon={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
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
          👷 {t('分包商主档 / Subcon', 'Sub-Contractors')}
        </div>
        <div className="mt-1 text-xs text-slate-300">
          {t(
            '先建好每个分包商的资料，出证书时一键带出。',
            'Set up each sub-contractor here; certificates auto-fill from it.',
          )}
        </div>
      </div>

      <button
        onClick={() => setEditing('new')}
        className="w-full rounded-2xl bg-white py-3 text-sm font-medium text-amber-600 shadow-sm hover:bg-amber-50"
      >
        {t('＋ 新增分包商', '＋ New sub-contractor')}
      </button>

      {subcons.length === 0 && (
        <div className="rounded-2xl bg-white py-8 text-center text-sm text-slate-400 shadow-sm">
          {t('还没有分包商，点上面「＋ 新增分包商」', 'No sub-contractors yet — tap “＋ New” above')}
        </div>
      )}

      {subcons.map((s) => {
        const trades = (s.scopes ?? []).map((x) => x.element).filter(Boolean).join('、')
        return (
          <button
            key={s.id}
            onClick={() => setEditing(s)}
            className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 text-left shadow-sm hover:bg-amber-50"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-bold text-slate-800">{s.name}</span>
                {!s.active && (
                  <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {t('停用', 'Inactive')}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400">
                {[trades, s.project].filter(Boolean).join(' · ') || t('点开填资料', 'Open to edit')}
              </div>
            </div>
            <span className="shrink-0 text-slate-300">›</span>
          </button>
        )
      })}
    </div>
  )
}

// ============================================================================
// 分包商编辑表单
// ============================================================================
function SubconForm({
  subcon,
  onClose,
  onSaved,
  onError,
}: {
  subcon: Subcon | null
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const { t } = useI18n()
  const s = subcon

  // 文字字段用一个草稿对象；价位用数字表格单独存
  const [f, setF] = useState<Record<string, string>>({
    name: s?.name ?? '',
    id_no: s?.id_no ?? '',
    contact_person: s?.contact_person ?? '',
    phone: s?.phone ?? '',
    email: s?.email ?? '',
    address: s?.address ?? '',
    project: s?.project ?? '',
    contract_sum: s?.contract_sum ?? '',
    retention_pct: s?.retention_pct != null ? String(s.retention_pct) : '5',
    date_commencement: s?.date_commencement ?? '',
    date_completion: s?.date_completion ?? '',
    term_of_payment: s?.term_of_payment ?? '45 days',
    bank_name: s?.bank_name ?? '',
    bank_account_no: s?.bank_account_no ?? '',
    bank_account_name: s?.bank_account_name ?? '',
    ref_la: s?.ref_la ?? '',
    subcon_ref: s?.subcon_ref ?? '',
    note: s?.note ?? '',
  })
  const [entityType, setEntityType] = useState<'company' | 'individual'>(s?.entity_type ?? 'individual')
  const [active, setActive] = useState<boolean>(s?.active ?? true)
  // 工种价位表（每行：工种 + 价位字符串 + 单位）
  const [scopes, setScopes] = useState<{ element: string; rate: string; unit: string }[]>(
    s?.scopes && s.scopes.length > 0
      ? s.scopes.map((x) => ({ element: x.element, rate: fmtRate(x.rate), unit: x.unit }))
      : [{ element: '', rate: '', unit: '' }],
  )
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))

  function setScope(i: number, key: 'element' | 'rate' | 'unit', v: string) {
    setScopes((p) => p.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)))
  }
  function addScope() {
    setScopes((p) => [...p, { element: '', rate: '', unit: '' }])
  }
  function removeScope(i: number) {
    setScopes((p) => (p.length <= 1 ? p : p.filter((_, idx) => idx !== i)))
  }

  async function save() {
    if (!f.name.trim()) {
      onError(t('请填分包商名字。', 'Please enter the sub-contractor name.'))
      return
    }
    setBusy(true)
    try {
      const scopeLines: ScopeLine[] = scopes.map((row) => ({
        element: row.element.trim(),
        rate: parseAmount(row.rate),
        unit: row.unit.trim(),
      }))
      await store.saveSubcon({
        id: subcon?.id,
        name: f.name,
        entity_type: entityType,
        id_no: f.id_no || null,
        contact_person: f.contact_person || null,
        phone: f.phone || null,
        email: f.email || null,
        address: f.address || null,
        project: f.project || null,
        scopes: scopeLines,
        contract_sum: f.contract_sum || null,
        retention_pct: parseAmount(f.retention_pct),
        date_commencement: f.date_commencement || null,
        date_completion: f.date_completion || null,
        term_of_payment: f.term_of_payment || null,
        bank_name: f.bank_name || null,
        bank_account_no: f.bank_account_no || null,
        bank_account_name: f.bank_account_name || null,
        ref_la: f.ref_la || null,
        subcon_ref: f.subcon_ref || null,
        note: f.note || null,
        active,
      })
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!subcon) return
    if (!window.confirm(t('确定删除这个分包商？（建议用「停用」而不是删）', 'Delete this sub-contractor? (Consider marking inactive instead.)')))
      return
    try {
      await store.deleteSubcon(subcon.id)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  // 一个「标签 + 输入框」小行
  const field = (label: string, k: string, placeholder = '') => (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <input
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-amber-400 focus:outline-none"
      />
    </label>
  )

  const sectionCls = 'rounded-2xl bg-white p-4 shadow-sm space-y-3'
  const titleCls = 'text-xs font-bold uppercase tracking-wide text-slate-400'

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      {/* 顶部工具条 */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-2 bg-slate-100/90 px-4 py-2 backdrop-blur">
        <button onClick={onClose} className="text-sm text-slate-600">
          ← {t('返回', 'Back')}
        </button>
        <div className="flex items-center gap-2">
          {subcon && (
            <button
              onClick={remove}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-red-50 hover:text-red-600"
            >
              {t('删除', 'Delete')}
            </button>
          )}
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            ✅ {t('保存', 'Save')}
          </button>
        </div>
      </div>

      {/* 基本资料 */}
      <div className={sectionCls}>
        <div className={titleCls}>{t('基本资料', 'Basic')}</div>
        {field(t('名字（公司/个人）', 'Name (company/person)'), 'name', 'IKHSAN BIN HARIADI')}
        <div>
          <span className="text-[11px] font-medium text-slate-500">{t('类型', 'Type')}</span>
          <div className="mt-1 flex gap-2">
            {(['individual', 'company'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setEntityType(v)}
                className={
                  'flex-1 rounded-lg border px-3 py-2 text-sm ' +
                  (entityType === v
                    ? 'border-amber-400 bg-amber-50 font-semibold text-amber-700'
                    : 'border-slate-200 text-slate-500')
                }
              >
                {v === 'individual' ? t('个人', 'Individual') : t('公司', 'Company')}
              </button>
            ))}
          </div>
        </div>
        {field(
          entityType === 'company' ? t('公司注册号 (SSM)', 'Company Reg No (SSM)') : t('身份证 / 护照号', 'IC / Passport No'),
          'id_no',
        )}
        {entityType === 'company' && field(t('联系人', 'Contact person'), 'contact_person')}
        {field(t('电话', 'Phone'), 'phone', '012-345 6789')}
        {field(t('邮箱', 'Email'), 'email')}
        {field(t('地址', 'Address'), 'address')}
      </div>

      {/* 工程 / 工种价位 */}
      <div className={sectionCls}>
        <div className={titleCls}>{t('工程与工种', 'Engagement & scope')}</div>
        {field(t('项目', 'Project'), 'project', 'SEPUTEH')}

        <div>
          <span className="text-[11px] font-medium text-slate-500">
            {t('负责工种 + 价位', 'Trade + rate')}
          </span>
          <div className="mt-1 space-y-2">
            {scopes.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={row.element}
                  onChange={(e) => setScope(i, 'element', e.target.value)}
                  placeholder={t('工种，如 BARBENDER', 'Trade, e.g. BARBENDER')}
                  className="min-w-0 flex-[2] rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:border-amber-400 focus:outline-none"
                />
                <input
                  value={row.rate}
                  inputMode="decimal"
                  onChange={(e) => setScope(i, 'rate', e.target.value)}
                  onBlur={() => setScope(i, 'rate', fmtRate(parseAmount(row.rate)))}
                  placeholder={t('价位', 'Rate')}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-right text-sm focus:border-amber-400 focus:outline-none"
                />
                <input
                  value={row.unit}
                  onChange={(e) => setScope(i, 'unit', e.target.value)}
                  placeholder={t('单位', 'Unit')}
                  className="w-16 min-w-0 rounded-lg border border-slate-200 px-2 py-2 text-sm focus:border-amber-400 focus:outline-none"
                />
                <button
                  onClick={() => removeScope(i)}
                  className="shrink-0 px-1.5 text-slate-300 hover:text-red-500"
                  title={t('删除这行', 'Remove')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addScope}
            className="mt-2 text-xs font-medium text-amber-600 hover:underline"
          >
            {t('＋ 加一个工种', '＋ Add trade')}
          </button>
          <div className="mt-1 text-[10px] text-slate-400">
            {t('单位可填 /吨、/m²、/天、lump sum 等；不确定可留空。', 'Unit e.g. /tonne, /m², /day, lump sum; optional.')}
          </div>
        </div>

        {field(t('合同额（可填 Nil）', 'Contract Sum (or Nil)'), 'contract_sum', 'Nil')}
        <div className="grid grid-cols-2 gap-3">
          {field(t('保留金 %', 'Retention %'), 'retention_pct')}
          {field(t('付款期', 'Term of Payment'), 'term_of_payment', '45 days')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field(t('开工日', 'Commencement'), 'date_commencement')}
          {field(t('完工日', 'Completion'), 'date_completion', 'Until complete')}
        </div>
      </div>

      {/* 银行付款 */}
      <div className={sectionCls}>
        <div className={titleCls}>{t('银行付款户口', 'Bank account')}</div>
        {field(t('银行', 'Bank'), 'bank_name', 'MAYBANK')}
        {field(t('户口号', 'Account No'), 'bank_account_no')}
        {field(t('户口名字（收款人）', 'Account name (payee)'), 'bank_account_name')}
      </div>

      {/* 证书栏位 / 其它 */}
      <div className={sectionCls}>
        <div className={titleCls}>{t('证书栏位 / 其它', 'Certificate refs / other')}</div>
        {field('Ref of LA', 'ref_la')}
        {field('Sub-Contractor Ref', 'subcon_ref')}
        {field(t('备注', 'Note'), 'note')}
        <label className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
          />
          <span className="text-sm text-slate-600">
            {t('在用（取消勾选＝停用，仍保留资料）', 'Active (uncheck to keep but mark inactive)')}
          </span>
        </label>
      </div>
    </div>
  )
}
