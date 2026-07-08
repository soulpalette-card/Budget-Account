// ============================================================================
// 文件摘要（store.ts）—— 唯一的“数据层”，所有读写都走这里
// ----------------------------------------------------------------------------
// 【铁律】除了这个文件和 supabase.ts，别的地方【不许】直接调用 supabase 查询。
// 组件想拿数据、存数据、删数据，一律调用这里导出的简单函数：
//   登录相关：signIn / signUp / signOut / getSession / onAuthChange / resetPassword
//   月份    ：getMonths / addMonth / updateMonth
//   记录    ：getEntries / getAllEntries / saveEntry / deleteEntry / restoreEntry / getDeletedEntries
//   模板    ：getTemplates / saveTemplate / deleteTemplate
//   高级    ：addNextMonth（新增下个月，自动带模板、期初=上月实际期末）
//
// 好处：以后想换数据库、改字段，只改这一个文件，界面基本不用动。
// 每个函数出错都会 throw，界面用 try/catch 接住并显示中文错误。
// ============================================================================

import { supabase } from './supabase'
import type {
  Confidence,
  Entry,
  Month,
  RecurringTemplate,
  TemplateKind,
  Zone,
} from '../types'
import { computeSeries } from '../calc'
import { round2 } from './money'

// ----------------------------------------------------------------------------
// 内部小助手：拿到“当前登录用户的 id”。没登录就报错。
// 写数据时需要它来填 user_id（配合数据库 RLS 保证数据隔离）。
// ----------------------------------------------------------------------------
async function getUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error('拿不到登录信息：' + error.message)
  if (!data.user) throw new Error('你还没登录，请先登录。')
  return data.user.id
}

// ============================================================================
// 一、登录相关（Auth）
// AuthContext 会调用这些，组件不用直接碰 supabase.auth。
// ============================================================================

// 登录（邮箱 + 密码）
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

// 注册（邮箱 + 密码）
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

// 登出
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// 拿当前会话（刷新页面时用来判断“还登录着吗”）
export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

// 监听登录状态变化（登录/登出时自动通知界面）
export function onAuthChange(callback: (userEmail: string | null, userId: string | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user?.email ?? null, session?.user?.id ?? null)
  })
  // 返回“取消监听”的函数，组件卸载时调用
  return () => data.subscription.unsubscribe()
}

// 发送“重设密码”邮件
export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // 用户点邮件里的链接后，回到本站首页（可按需改）
    redirectTo: window.location.origin,
  })
  if (error) throw error
}

// ============================================================================
// 二、月份（months）
// ============================================================================

// 拿到当前用户的所有月份，按 sort_order 从小到大排。
export async function getMonths(): Promise<Month[]> {
  const { data, error } = await supabase
    .from('months')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as Month[]
}

// 新增一个月。opening_balance 默认 0，sort_order 默认排到最后。
export async function addMonth(input: {
  label: string
  opening_balance?: number
  sort_order?: number
}): Promise<Month> {
  const userId = await getUserId()

  // 如果没给 sort_order，就自动排到现有月份的最后面
  let sortOrder = input.sort_order
  if (sortOrder === undefined) {
    const months = await getMonths()
    sortOrder = months.length > 0 ? Math.max(...months.map((m) => m.sort_order)) + 1 : 0
  }

  const { data, error } = await supabase
    .from('months')
    .insert({
      user_id: userId,
      label: input.label,
      opening_balance: round2(input.opening_balance ?? 0), // 金额固定两位小数
      sort_order: sortOrder,
    })
    .select()
    .single()
  if (error) throw error
  return data as Month
}

// 修改月份（比如改期初余额、改名字、改排序）。只传要改的字段即可。
export async function updateMonth(
  id: string,
  patch: Partial<Pick<Month, 'label' | 'opening_balance' | 'sort_order'>>,
): Promise<void> {
  // 如果改到金额，顺手 round2
  const clean: Record<string, unknown> = { ...patch }
  if (patch.opening_balance !== undefined) {
    clean.opening_balance = round2(patch.opening_balance)
  }
  const { error } = await supabase.from('months').update(clean).eq('id', id)
  if (error) throw error
}

// ============================================================================
// 三、记录（entries）—— 收入 / 支出 / 突发
// ============================================================================

// 拿某个月的所有记录（默认排除软删除的）。
// includeDeleted=true 时把删掉的也一起拿（设置页“恢复”功能用）。
export async function getEntries(
  monthId: string,
  includeDeleted = false,
): Promise<Entry[]> {
  let query = supabase.from('entries').select('*').eq('month_id', monthId)
  if (!includeDeleted) query = query.eq('is_deleted', false)
  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Entry[]
}

// 拿当前用户的【所有】记录（总览页一次算 6 个月时用，省得一个个查）。
export async function getAllEntries(includeDeleted = false): Promise<Entry[]> {
  let query = supabase.from('entries').select('*')
  if (!includeDeleted) query = query.eq('is_deleted', false)
  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Entry[]
}

// 拿所有“被软删除”的记录（设置页里列出来给人恢复）。
export async function getDeletedEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('is_deleted', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Entry[]
}

// 保存一条记录：有 id 就更新，没 id 就新增。返回保存后的完整记录。
// 这是明细页“点格子编辑 / 加一行”共用的入口。
export async function saveEntry(input: {
  id?: string
  month_id: string
  zone: Zone
  entry_date?: string | null
  amount?: number
  category?: string | null
  description?: string | null
  confidence?: Confidence | null
  settled?: boolean
  is_unexpected?: boolean
  note?: string | null
}): Promise<Entry> {
  const userId = await getUserId()

  // 组装要写进数据库的字段，金额固定两位小数
  const row = {
    user_id: userId, // 记录“谁建的”（现在数据共享，这只是留个痕迹，不再限制可见范围）
    month_id: input.month_id,
    zone: input.zone,
    entry_date: input.entry_date ?? null,
    amount: round2(input.amount ?? 0),
    category: input.category ?? null,
    description: input.description ?? null,
    confidence: input.confidence ?? null,
    settled: input.settled ?? false,
    is_unexpected: input.is_unexpected ?? false, // 是否意外项（默认否=规划项）
    note: input.note ?? null,
  }

  if (input.id) {
    // 有 id → 更新这一行
    const { data, error } = await supabase
      .from('entries')
      .update(row)
      .eq('id', input.id)
      .select()
      .single()
    if (error) throw error
    return data as Entry
  } else {
    // 没 id → 新增一行
    const { data, error } = await supabase.from('entries').insert(row).select().single()
    if (error) throw error
    return data as Entry
  }
}

// ✅ 打勾/取消打勾：把某条规划项标成“已实现 / 未实现”。
// 明细页那个勾选框直接调它，改这一个字段，最省事。
export async function setSettled(id: string, settled: boolean): Promise<void> {
  const { error } = await supabase.from('entries').update({ settled }).eq('id', id)
  if (error) throw error
}

// 删除一条记录 —— 【软删除】：只是把 is_deleted 标成 true，数据还在，能恢复。
// 【绝不硬删除】。
export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('entries').update({ is_deleted: true }).eq('id', id)
  if (error) throw error
}

// 恢复一条被软删除的记录（把 is_deleted 改回 false）。
export async function restoreEntry(id: string): Promise<void> {
  const { error } = await supabase.from('entries').update({ is_deleted: false }).eq('id', id)
  if (error) throw error
}

// ============================================================================
// 四、重复项目模板（recurring_templates）
// ============================================================================

// 拿当前用户的所有模板
export async function getTemplates(): Promise<RecurringTemplate[]> {
  const { data, error } = await supabase
    .from('recurring_templates')
    .select('*')
    .order('kind', { ascending: true })
  if (error) throw error
  return (data ?? []) as RecurringTemplate[]
}

// 保存模板：有 id 更新，没 id 新增
export async function saveTemplate(input: {
  id?: string
  kind: TemplateKind
  amount?: number
  category?: string | null
  description?: string | null
  day_of_month?: number | null
}): Promise<RecurringTemplate> {
  const userId = await getUserId()
  const row = {
    user_id: userId,
    kind: input.kind,
    amount: round2(input.amount ?? 0),
    category: input.category ?? null,
    description: input.description ?? null,
    day_of_month: input.day_of_month ?? null,
  }
  if (input.id) {
    const { data, error } = await supabase
      .from('recurring_templates')
      .update(row)
      .eq('id', input.id)
      .select()
      .single()
    if (error) throw error
    return data as RecurringTemplate
  } else {
    const { data, error } = await supabase
      .from('recurring_templates')
      .insert(row)
      .select()
      .single()
    if (error) throw error
    return data as RecurringTemplate
  }
}

// 删除模板（模板只是“样板”，不是真实账目，这里直接删掉）。
export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('recurring_templates').delete().eq('id', id)
  if (error) throw error
}

// ============================================================================
// 五、高级：新增下个月
// 逻辑：
//   1. 找到现有最后一个月，算出它的“实际期末”当作新月份的期初余额
//   2. 建一个新月份（排到最后）
//   3. 把所有重复模板，按 kind（收入/支出）变成新月份的记录塞进去
// ============================================================================
export async function addNextMonth(newLabel: string): Promise<Month> {
  // 1) 先把现有月份和它们的记录都拿来，算出最后一个月的实际期末
  const months = await getMonths()
  let openingForNew = 0

  if (months.length > 0) {
    const allEntries = await getAllEntries()
    // 按月分组，喂给 calc 算整条链
    const entriesByMonth: Record<string, Entry[]> = {}
    for (const m of months) entriesByMonth[m.id] = []
    for (const e of allEntries) {
      if (entriesByMonth[e.month_id]) entriesByMonth[e.month_id].push(e)
    }
    const series = computeSeries(months, entriesByMonth)
    // 最后一个月的实际期末，就是新月份的期初余额
    openingForNew = series[series.length - 1].liveClosing
  }

  // 2) 建新月份
  const newMonth = await addMonth({
    label: newLabel,
    opening_balance: openingForNew,
  })

  // 3) 把模板变成新月份的记录
  const templates = await getTemplates()
  for (const t of templates) {
    // 模板 kind 只有 income/expense；突发不做模板（突发本来就是没计划的）
    const zone: Zone = t.kind === 'income' ? 'income' : 'expense'
    await saveEntry({
      month_id: newMonth.id,
      zone,
      amount: t.amount,
      category: t.category,
      description: t.description,
      // 模板带进来的收入，默认把握度给“很可能”，用户可再改
      confidence: t.kind === 'income' ? 'Likely' : null,
      note: '（由重复模板自动带入）',
    })
  }

  return newMonth
}
