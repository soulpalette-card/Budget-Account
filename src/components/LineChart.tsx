// ============================================================================
// 文件摘要（LineChart.tsx）
// ----------------------------------------------------------------------------
// 一个很轻的折线图，纯手画 SVG，不依赖任何图表库（省得多装东西）。
// 用来画“实际期末”这几个月的走势。数据点会自动缩放到画布高度。
//   用法：<LineChart points={[{label:'七月', value:1000}, ...]} />
// ============================================================================

import { formatMoney } from '../lib/money'

interface Point {
  label: string
  value: number
}

export function LineChart({ points }: { points: Point[] }) {
  // 没数据就别画了
  if (points.length === 0) {
    return <div className="py-8 text-center text-slate-400">暂无数据</div>
  }

  // 画布尺寸（用 viewBox 让它能自适应宽度）
  const width = 720
  const height = 220
  const padding = { top: 20, right: 20, bottom: 40, left: 20 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  // 找出数值的最大最小，用来把金额映射到画布高度
  const values = points.map((p) => p.value)
  let min = Math.min(...values, 0) // 至少把 0 包进来，好看出正负
  let max = Math.max(...values, 0)
  if (min === max) {
    // 全都一样时，撑开一点，免得线贴边
    min -= 1
    max += 1
  }

  // 把一个数值换算成画布上的 y 坐标（值越大越靠上）
  const toY = (v: number) => padding.top + innerH - ((v - min) / (max - min)) * innerH
  // 把第 i 个点换算成 x 坐标（均匀分布）
  const toX = (i: number) =>
    padding.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)

  // 折线的路径字符串
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.value).toFixed(1)}`)
    .join(' ')

  // 0 这条水平参考线的位置
  const zeroY = toY(0)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="实际期末走势图">
      {/* 0 参考线（虚线灰色） */}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={zeroY}
        y2={zeroY}
        stroke="#cbd5e1"
        strokeDasharray="4 4"
      />
      {/* 折线本身 */}
      <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2.5} />
      {/* 每个数据点：圆点 + 上方金额 + 下方月份名 */}
      {points.map((p, i) => {
        const x = toX(i)
        const y = toY(p.value)
        const negative = p.value < 0
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={4} fill={negative ? '#dc2626' : '#2563eb'} />
            <text
              x={x}
              y={y - 10}
              textAnchor="middle"
              className="fill-slate-600"
              fontSize={11}
            >
              {formatMoney(p.value)}
            </text>
            <text
              x={x}
              y={height - 12}
              textAnchor="middle"
              className="fill-slate-500"
              fontSize={12}
            >
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
