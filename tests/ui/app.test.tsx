import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';
import { chatStore, memoryStore, store } from '../../src/ui/appState';

describe('App 冒烟', () => {
  beforeEach(() => {
    cleanup();
    store.clearAll();
    memoryStore.clearAll();
    chatStore.clearAll();
  });

  it('渲染主界面与导航', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '智能记账' })).toBeInTheDocument();
    for (const tab of ['对话', '账户', '日历', '流水', '统计', '设置']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    }
  });

  it('添加账户 → 对话记账 → 流水可见', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 添加账户
    await user.click(screen.getByRole('button', { name: '账户' }));
    await user.type(screen.getByLabelText('账户名'), '微信零钱');
    await user.type(screen.getByLabelText('初始余额'), '1000');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('微信零钱')).toBeInTheDocument();

    // 对话记账
    await user.click(screen.getByRole('button', { name: '对话' }));
    await user.type(screen.getByLabelText('记账输入'), '吃面25');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText(/已记支出/)).toBeInTheDocument();
    expect(store.state.transactions).toHaveLength(1);

    // 流水页可见
    await user.click(screen.getByRole('button', { name: '流水' }));
    expect(screen.getByText('-¥25.00')).toBeInTheDocument();
  });

  it('数据持久化：store.save 后可重新 load', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '账户' }));
    await user.type(screen.getByLabelText('账户名'), '现金');
    await user.click(screen.getByRole('button', { name: '添加' }));

    const { Store } = await import('../../src/core/store/store');
    const reloaded = new Store();
    expect(reloaded.load()).toBe(true);
    expect(reloaded.state.accounts.some((a) => a.name === '现金')).toBe(true);
  });
});
