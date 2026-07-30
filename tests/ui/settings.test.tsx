import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsView } from '../../src/ui/SettingsView';

/**
 * 设置页渲染：验证标题与 AI 配置区块（i18n 已移除，文案为固定中文）。
 */
describe('UI: SettingsView 渲染', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('显示标题与 AI 配置区块', () => {
    render(<SettingsView onChanged={() => {}} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('设置');
    expect(screen.getByText('AI 助手配置')).toBeInTheDocument();
    expect(screen.getByText('数据管理')).toBeInTheDocument();
  });
});
