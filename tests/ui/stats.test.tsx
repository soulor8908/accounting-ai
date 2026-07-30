import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsView } from '../../src/ui/StatsView';

/**
 * 统计页渲染：验证标题与导出按钮文案（i18n 已移除，文案为固定中文）。
 */
describe('UI: StatsView 导出按钮', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('显示标题与导出按钮', () => {
    render(<StatsView />);
    expect(screen.getByText('统计')).toBeInTheDocument();
    expect(screen.getByText('导出月度报表 (CSV)')).toBeInTheDocument();
    expect(screen.getByText('导出趋势图 (PNG)')).toBeInTheDocument();
  });
});
