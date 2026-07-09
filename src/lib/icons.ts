// ============================================================================
// 文件摘要（icons.ts）
// ----------------------------------------------------------------------------
// 分类 → 小图标的对照表。账户页和 6个月总览都用它，保证图标一致。
// 想给某个分类换图标，改这里一个字（emoji）即可。
// ============================================================================

import type { Entry } from '../types'

export const CATEGORY_ICON: Record<string, string> = {
  薪资: '💰',
  房租: '🏠',
  水电网络: '💡',
  原料采购: '📦',
  设备: '🛠️',
  市场推广: '📣',
  交通: '🚗',
  税费: '🧾',
  销售收入: '🛒',
  其他: '📌',
}

// 找一笔记录该显示什么图标：先看分类，没有就按 收入💵 / 支出💸
export function iconFor(e: Pick<Entry, 'category' | 'zone'>): string {
  if (e.category && CATEGORY_ICON[e.category]) return CATEGORY_ICON[e.category]
  return e.zone === 'income' ? '💵' : '💸'
}
