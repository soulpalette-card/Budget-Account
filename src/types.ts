// ============================================================================
// 文件摘要（types.ts）
// ----------------------------------------------------------------------------
// 这里定义整个程序用到的“数据长什么样”。TypeScript 靠这些定义帮我们挑错，
// 比如你把 amount 写成文字它就会提醒你。改数据库字段时，这里也要同步改。
// 这些形状要和 supabase/schema.sql 里的表结构对得上。
// ============================================================================

// 一行记录属于哪个“区块”：
//   income     = 预定收入
//   expense    = 预定支出
//   unexpected = 突发支出 🔺（就是那些没计划到、要靠缓冲金吸收的）
export type Zone = 'income' | 'expense' | 'unexpected'

// 收入的“把握度”（这笔钱到底有多稳）：
//   Confirmed = 已确认（板上钉钉）
//   Likely    = 很可能
//   Tentative = 暂定（八字没一撇，勾了筛选就会被排除）
export type Confidence = 'Confirmed' | 'Likely' | 'Tentative'

// 重复项目模板的类型：收入还是支出
export type TemplateKind = 'income' | 'expense'

// months 表：一个月一条
export interface Month {
  id: string // 这个月的唯一编号（Supabase 自动生成的 uuid）
  user_id: string // 属于哪个用户（安全隔离靠它）
  label: string // 月份名字，例如 "2026-07" 或 "七月"
  sort_order: number // 排序用的序号，越小越靠前
  opening_balance: number // 期初余额（这个月一开始手里有多少钱）
  budget_locked: boolean // 预算是否已锁定：锁定后规划栏冻结，新记的自动进“临时增加”
  created_at: string // 创建时间
}

// entries 表：每一笔收入/支出/突发都是一行
export interface Entry {
  id: string // 唯一编号
  user_id: string // 属于哪个用户
  month_id: string // 属于哪个月
  zone: Zone // 属于哪个区块（收入/支出/突发）
  entry_date: string | null // 这笔钱的日期（可以空着）
  amount: number // 金额（数据库里是 numeric(14,2)，永远两位小数）
  category: string | null // 分类（下拉框选的）
  description: string | null // 说明文字
  confidence: Confidence | null // 把握度（主要给收入用）
  settled: boolean // ✅ 打勾：这笔“规划项”是否已按规划实现（实际发生了）
  is_unexpected: boolean // 是否“意外项”：true=不在规划内的临时收支；false=月初就规划好的
  sub_items: SubItem[] | null // 子项目/明细（拆单）；为空就是普通一笔
  actual_logs: LogItem[] | null // 累计项：每天的实际花费；非空=累计项，实际=这些之和
  note: string | null // 备注栏
  is_deleted: boolean // 软删除标记：true = 已删（但没真删，可恢复）
  created_at: string // 创建时间
}

// 一笔账里的「子项目/明细」：一张大单据拆成几张小单据
//   例：一笔 office expenses 9150 = 复印机 5000 + 电话费 4150
//   有子项目时，这笔账的 amount 会自动等于所有子项目金额之和。
export interface SubItem {
  desc: string // 小项目说明，例如“复印机”“电话费”
  amount: number // 小项目金额
}

// 「累计项」里每天的一笔实际花费（预算不变，实际按天累加）
//   例：OT买饭 预算 2000，今天花 80、明天花 100 …
export interface LogItem {
  date: string | null // 哪一天
  desc?: string | null // 名称（可选，例如“麦当劳”“加班晚餐”）
  amount: number // 当天花了多少
}

// 一张「进度付款证书」的全部内容（存进 subcon_claims.cert 这个 jsonb 里）
//   金额都是数字；文字都是字符串。计算(小计/保留金/净额/应付)由程序自动算。
export interface CertData {
  claimPeriod?: string // 顶部日期范围，如 "01st-Feb-24 to 29th-Feb-24"
  // —— 项目信息 ——
  refLA?: string
  subconRef?: string
  dateCommencement?: string // 开工日
  dateCompletion?: string // 完工日
  projectTitle?: string // 项目名，如 SEPUTEH
  // —— 分包商 / claim 信息 ——
  subContractor?: string // 分包商名字（也是分组依据）
  trade?: string // 工种，如 BARBENDER & CARPENTER
  contractSum?: string // 合同额（可填 Nil，所以用文字）
  retentionPct?: number // Limit of Retention %
  claimNo?: number // 第几期
  periodEnding?: string // 结算期，如 June 26
  valuationDate?: string // 估价日
  termOfPayment?: string // 付款期，如 45 days
  // —— 金额（计算表）——
  workdone?: number // 1 VALUE OF WORKDONE
  vo?: number // 2 ADDITION (Variation Order)
  advance3?: number // 3 Advance
  addAdvance?: number // 5 ADDITION - Advance
  addKsk?: number // 5 ADDITION - KSK
  addOthers?: number // 5 ADDITION - Others
  dedPrevious?: number // 6 DEDUCTION - Previous Amount Payment
  dedKsk?: number // 6 DEDUCTION - KSK
  dedBackcharge?: number // 6 DEDUCTION - Backcharge
  // —— 签名栏名字 ——
  preparedBy?: string
  verifiedBy?: string
  checkedBy?: string // 附 (Project Manager)
  approvedBy?: string // 附 (Director)
}

// subcon_claims 表：QS 给分包商(subcon)出的每期进度款证书(cert/claim)
//   一行 = 一张证书。subcon/claim_no 用来分组排序；完整内容在 cert(jsonb)。
export interface SubconClaim {
  id: string // 唯一编号
  user_id: string // 谁建的（共享，不限可见范围）
  subcon: string // 分包商名称（分组依据，= cert.subContractor）
  claim_no: number // 第几期（= cert.claimNo）
  claim_month: string | null // 结算期（= cert.periodEnding），列表显示用
  gross_amount: number // 本期应付总额（自动算出，列表显示用）
  retention_pct: number // 保留金百分比
  cert: CertData | null // 证书完整内容（jsonb）
  note: string | null // 备注
  created_at: string // 创建时间
}

// recurring_templates 表：每月自动重复的项目（房租、薪资这种）
export interface RecurringTemplate {
  id: string // 唯一编号
  user_id: string // 属于哪个用户
  kind: TemplateKind // 收入还是支出
  amount: number // 金额
  category: string | null // 分类
  description: string | null // 说明
  day_of_month: number | null // 每月几号（1~31，只是备注用，可空）
}
