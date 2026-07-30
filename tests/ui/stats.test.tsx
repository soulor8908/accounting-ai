import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsView } from '../../src/ui/StatsView';
import { setLang } from '../../src/i18n/index';

/**
 * P1-2 UI 测试扩面：验证统计页导出按钮与标题的本地化，
 * 覆盖 P2 报表导出按钮 + P2 i18n 的 UI 接线。
 */
describe('P1-2 UI: StatsView 导出按钮与本地化', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('zh');
  });

  it('中文下显示本地化标题与导出按钮', () => {
    render(<StatsView />);
    expect(screen.getByText('统计')).toBeInTheDocument();
    expect(screen.getByText('导出月度报表 (CSV)')).toBeInTheDocument();
    expect(screen.getByText('导出趋势图 (PNG)')).toBeInTheDocument();
  });

  it('切换为英文后导出按钮文案同步本地化', () => {
    setLang('en');
    render(<StatsView />);
    expect(screen.getByText('Statistics')).toBeInTheDocument();
    expect(screen.getByText('Export Monthly Report (CSV)')).toBeInTheDocument();
    expect(screen.getByText('Export Trend Chart (PNG)')).toBeInTheDocument();
  });
});
