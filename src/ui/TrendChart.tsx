/**
 * 纯 SVG 支出走势图（零依赖，确定性渲染）。
 *
 * 展示「本月累计支出」与「上月累计支出」的逐日曲线对比，叠加：
 *   - 上月合计参考线（虚线）：一眼看出本月节奏是否超过上月
 *   - 预计全月标记（空心点）：把 analyzeTrends 的预测落到图上
 *
 * 设计原则：不引入图表库，直接画 SVG，跟随现有 styles.css 的设计令牌
 * （通过 CSS 变量，确保主题一致）。
 */
interface Point {
  day: number;
  value: number;
}

interface TrendChartProps {
  /** 本月逐日累计支出 */
  current: Point[];
  /** 上月逐日累计支出（可选） */
  previous?: Point[];
  /** 上月全月合计，画一条水平参考线 */
  prevTotal?: number;
  /** 预计全月支出（analyzeTrends.projectedMonthExpense） */
  projected?: number;
  /** 画布高度，默认 200 */
  height?: number;
}

const W = 340;
const PAD_L = 38;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;

function fmtAxis(v: number): string {
  if (v >= 10000) {
    const wan = v / 10000;
    return `¥${Number.isInteger(wan) ? wan : wan.toFixed(1)}万`;
  }
  return `¥${Math.round(v)}`;
}

export function TrendChart({ current, previous, prevTotal, projected, height = 200 }: TrendChartProps) {
  const plotW = W - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const hasData = current.length > 0 || (previous?.length ?? 0) > 0;
  if (!hasData) {
    return <p className="empty">暂无支出数据，记几笔就能看到走势啦。</p>;
  }

  const lastCur = current[current.length - 1]?.value ?? 0;
  const lastPrev = previous?.[previous.length - 1]?.value ?? 0;
  const maxDay = Math.max(current.length, previous?.length ?? 0, 1);
  const rawMax = Math.max(lastCur, lastPrev, prevTotal ?? 0, projected ?? 0, 1);
  const maxY = rawMax * 1.15; // 顶部留白
  const denom = Math.max(maxDay - 1, 1);

  const xOf = (day: number) => PAD_L + ((day - 1) / denom) * plotW;
  const yOf = (v: number) => PAD_T + plotH - (v / maxY) * plotH;

  const toPath = (pts: Point[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.day).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');

  const curPath = toPath(current);
  const prevPath = previous && previous.length > 0 ? toPath(previous) : '';
  // 当月面积：从曲线下方闭合到基线
  const areaPath =
    current.length > 0
      ? `${curPath} L${xOf(current[current.length - 1].day).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(current[0].day).toFixed(1)},${yOf(0).toFixed(1)} Z`
      : '';

  // Y 轴网格（4 等分）
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    v: maxY * f,
    y: PAD_T + plotH - f * plotH,
  }));

  // X 轴刻度：首日、月中、末日
  const xTicks = [1, Math.ceil(maxDay / 2), maxDay].filter((d, i, a) => a.indexOf(d) === i);

  const projY = projected !== undefined ? yOf(projected) : null;
  const projX = xOf(maxDay);

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label="支出走势图" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="curArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--pine)' }} stopOpacity="0.22" />
            <stop offset="100%" style={{ stopColor: 'var(--pine)' }} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* 网格 + Y 轴标签 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={t.y} x2={W - PAD_R} y2={t.y} style={{ stroke: 'var(--border-soft)' }} strokeWidth={1} />
            <text x={PAD_L - 6} y={t.y + 3} textAnchor="end" style={{ fill: 'var(--muted)', fontSize: 9 }} className="axis-text">
              {fmtAxis(t.v)}
            </text>
          </g>
        ))}

        {/* X 轴标签 */}
        {xTicks.map((d) => (
          <text key={d} x={xOf(d)} y={height - 7} textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: 9 }} className="axis-text">
            {d}日
          </text>
        ))}

        {/* 上月合计参考线 */}
        {prevTotal !== undefined && prevTotal > 0 && (
          <g>
            <line
              x1={PAD_L}
              y1={yOf(prevTotal)}
              x2={W - PAD_R}
              y2={yOf(prevTotal)}
              style={{ stroke: 'var(--cinnabar)' }}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text x={W - PAD_R} y={yOf(prevTotal) - 3} textAnchor="end" style={{ fill: 'var(--cinnabar)', fontSize: 8.5 }} className="axis-text">
              上月合计 {fmtAxis(prevTotal)}
            </text>
          </g>
        )}

        {/* 上月累计（虚线） */}
        {prevPath && (
          <path d={prevPath} fill="none" style={{ stroke: 'var(--muted)' }} strokeWidth={1.5} strokeDasharray="4 3" />
        )}

        {/* 本月面积 + 曲线 */}
        {areaPath && <path d={areaPath} fill="url(#curArea)" />}
        <path d={curPath} fill="none" style={{ stroke: 'var(--pine)' }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* 预计全月标记 */}
        {projY !== null && (
          <g>
            <circle cx={projX} cy={projY} r={3.5} fill="var(--card)" style={{ stroke: 'var(--amber)' }} strokeWidth={2} />
            <text x={projX} y={projY - 6} textAnchor="end" style={{ fill: 'var(--amber)', fontSize: 8.5 }} className="axis-text">
              预计 {fmtAxis(projected!)}
            </text>
          </g>
        )}
      </svg>

      <div className="trend-legend">
        <span className="lg-item"><i className="lg-line lg-cur" />本月</span>
        {previous && previous.length > 0 && (
          <span className="lg-item"><i className="lg-line lg-prev" />上月</span>
        )}
        {prevTotal !== undefined && prevTotal > 0 && (
          <span className="lg-item"><i className="lg-line lg-ref" />上月合计</span>
        )}
        {projected !== undefined && (
          <span className="lg-item"><i className="lg-dot" />预计全月</span>
        )}
      </div>
    </div>
  );
}
