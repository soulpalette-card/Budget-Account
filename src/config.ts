// ============================================================================
// 文件摘要（config.ts）
// ----------------------------------------------------------------------------
// 这是【所有可调参数】的集中地。想改程序的“规矩”，基本都在这一个文件里改，
// 不用去翻别的代码。改完保存，刷新网页就生效。
//
// 里面管的东西：
//   - 用什么货币符号（默认 "RM" 马币）
//   - 缓冲金（缓冲金 = 给突发支出准备的“救火钱”）怎么算：固定金额 or 百分比
//   - 安全线：余额低于多少就亮红灯警报
//   - 缓冲金没用完的部分，下个月要不要接着用（结转）
//   - 收入/支出的分类清单（下拉框里能选的项）
// ============================================================================

// 「缓冲金怎么算」的两种模式：
//   "fixed"   = 固定金额。比如每月固定留 3000 块当救火钱。
//   "percent" = 按预定支出的百分比。比如留“预定支出的 10%”。
export type BufferMode = 'fixed' | 'percent'

// 整个 config 的形状（TypeScript 用来检查我们没写错字段）
export interface AppConfig {
  currency: string // 货币符号，显示在金额前面，例如 "RM"
  bufferMode: BufferMode // 缓冲金算法：固定 or 百分比
  bufferValue: number // 配合上面：fixed 时是“金额”，percent 时是“百分数”（10 代表 10%）
  safeThreshold: number // ⚠️ 安全线：实际期末余额低于这个数就判定为“赤字/警报”
  rolloverBuffer: boolean // 缓冲金没用完的部分，下个月要不要结转接着用
  categories: string[] // 分类下拉框里能选的项目
}

// ↓↓↓ 真正的默认值，随便改 ↓↓↓
export const config: AppConfig = {
  // 货币符号。改成 "RM"、"¥"、"$" 都行。只影响“显示”，不影响计算。
  currency: 'RM',

  // 缓冲金模式：默认按“百分比”。想用固定金额就改成 'fixed'。
  bufferMode: 'percent',

  // 配合 bufferMode：
  //   - bufferMode='percent' 时，这里填百分数：10 = 预定支出的 10% 当缓冲金
  //   - bufferMode='fixed'   时，这里填金额：  3000 = 每月固定留 3000 当缓冲金
  bufferValue: 10,

  // 安全线：实际期末余额（liveClosing）低于这个数，状态就变“赤字(红)”。
  // 想更保守（更早报警）就调高，比如 5000。
  safeThreshold: 0,

  // 缓冲金结转：
  //   true  = 这个月缓冲金没花完，剩下的加到下个月缓冲金里（更宽松）
  //   false = 每个月缓冲金都是全新的，不累积（更严格）
  // 注意：当前版本主要在“单月计算”里体现，结转逻辑在 calc.ts 里有说明。
  rolloverBuffer: false,

  // 分类清单：明细页“预定支出/收入”的分类下拉框会用到这些选项。
  // 想加分类就往数组里加字符串，想删就删掉那一项。
  categories: [
    '薪资',
    '房租',
    '水电网络',
    '原料采购',
    '设备',
    '市场推广',
    '交通',
    '税费',
    '销售收入',
    '其他',
  ],
}

// ============================================================================
// 公司抬头信息（进度证书 Cert 页顶部会用到）
// ----------------------------------------------------------------------------
// 证书顶部的公司名、注册号、地址、电话、邮箱都从这里读。想改公司资料，改这里即可。
// （证书上不放 logo，按用户要求。）
// ============================================================================
export const company = {
  name: 'UNIKOYO CONSTRUCTION SDN BHD',
  regNo: '202201029640 (1475337-T)',
  address: 'Lot 195-B2/A, Lorong Kwantung 8, Kampung Kwantung Baru, 43000 Kajang.',
  phone: '012-526 9934 / 012-786 9935',
  email: 'unikoyoconstruction@gmail.com',
}

// ============================================================================
// 「设置」页临时改参数的机制（大白话）
// ----------------------------------------------------------------------------
// 上面的 config 是“出厂默认值”。但我们希望在网页的「设置」页里也能改这些参数，
// 而不用每次都来改代码。做法：把用户在设置页改的值存到浏览器本地(localStorage)，
// 程序一启动就把这些“本地覆盖值”盖到 config 上面。
//
// 注意：这些覆盖值存在【这台电脑的这个浏览器】里，换设备/清缓存会回到默认值。
// 想“永久改默认”，还是直接改上面 config 里的值最稳。
// ============================================================================

const OVERRIDE_KEY = 'unikoyo_config_overrides'

// 程序启动时：把本地存的覆盖值读出来，盖到 config 上
try {
  const raw = localStorage.getItem(OVERRIDE_KEY)
  if (raw) {
    const saved = JSON.parse(raw) as Partial<AppConfig>
    Object.assign(config, saved)
  }
} catch {
  // 读失败就用默认值，不影响程序运行
}

// 设置页保存参数时调用：存到本地，并盖到当前 config 上。
// 存完通常刷新一下页面(location.reload)，让所有计算都用新参数重算。
export function saveConfigOverrides(patch: Partial<AppConfig>): void {
  Object.assign(config, patch)
  const toSave: Partial<AppConfig> = {
    currency: config.currency,
    bufferMode: config.bufferMode,
    bufferValue: config.bufferValue,
    safeThreshold: config.safeThreshold,
    rolloverBuffer: config.rolloverBuffer,
    categories: config.categories,
  }
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(toSave))
}

// 恢复出厂默认（把本地覆盖清掉）。清完刷新页面即可。
export function resetConfigOverrides(): void {
  localStorage.removeItem(OVERRIDE_KEY)
}
