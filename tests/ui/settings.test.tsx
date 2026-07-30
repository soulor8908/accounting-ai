import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsView } from '../../src/ui/SettingsView';
import { setLang } from '../../src/i18n/index';

/**
 * P1-2 UI 测试扩面：通过真实组件渲染验证 i18n 语言切换在设置页生效，
 * 断言切换语言后标题文案与 localStorage 持久化同步变化。
 */
describe('P1-2 UI: SettingsView 语言切换', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('zh');
  });

  it('默认中文：标题显示「设置」，存在语言选择项', () => {
    render(<SettingsView onChanged={() => {}} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('设置');
    expect(screen.getByText('语言')).toBeInTheDocument();
  });

  it('切换为英文后标题同步变化并持久化到 localStorage', () => {
    render(<SettingsView onChanged={() => {}} />);
    // 语言选择项是 label 文字为「语言」的 form-row 内的 select
    const langLabel = screen.getByText('语言').closest('label') as HTMLElement;
    const langSelect = within(langLabel).getByRole('combobox') as HTMLSelectElement;

    fireEvent.change(langSelect, { target: { value: 'en' } });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Settings');
    expect(localStorage.getItem('ai-ledger-lang')).toBe('en');
  });

  it('英文下 AI 配置区块标题也本地化', () => {
    setLang('en');
    render(<SettingsView onChanged={() => {}} />);
    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    expect(screen.getByText('Data Management')).toBeInTheDocument();
  });
});
