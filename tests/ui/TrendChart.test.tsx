import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendChart } from '../../src/ui/TrendChart';

describe('TrendChart', () => {
  const current = Array.from({ length: 30 }, (_, i) => ({ day: i + 1, value: (i + 1) * 10 }));
  const previous = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, value: (i + 1) * 8 }));

  it('有数据时渲染 SVG 与本月曲线', () => {
    const { container } = render(
      <TrendChart current={current} previous={previous} prevTotal={248} projected={320} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
    const paths = container.querySelectorAll('path');
    // 含：本月面积 + 本月曲线 + 上月曲线
    expect(paths.length).toBeGreaterThanOrEqual(3);
  });

  it('显示「上月合计」与「预计全月」标记', () => {
    const { container } = render(
      <TrendChart current={current} previous={previous} prevTotal={248} projected={320} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent || '');
    expect(texts.some((s) => s.includes('上月合计'))).toBe(true);
    expect(texts.some((s) => s.includes('预计'))).toBe(true);
  });

  it('无数据时显示空状态占位', () => {
    render(<TrendChart current={[]} />);
    expect(screen.getByText(/暂无支出数据/)).toBeInTheDocument();
  });
});
