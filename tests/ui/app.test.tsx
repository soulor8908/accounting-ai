import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';
import { chatStore, memoryStore, store } from '../../src/ui/appState';

// 冒烟测试封闭：mock AI 客户端，chatWithAI 直接走 onError 回退到本地引擎，彻底摆脱外网依赖
vi.mock('../../src/core/ai/client', () => ({
  chatWithAI: vi.fn(async (
    _userMessage: string,
    _history: unknown[],
    _config: unknown,
    callbacks: { onError?: (error: string) => void },
  ) => {
    callbacks.onError?.('test: AI mocked, falling back to local engine');
  }),
  testAIConfig: vi.fn(async () => ({ ok: true, message: 'mocked' })),
}));

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

    // 添加账户（懒加载 chunk 需 await）
    await user.click(screen.getByRole('button', { name: '账户' }));
    await user.type(await screen.findByLabelText('账户名'), '微信零钱');
    await user.type(screen.getByLabelText('初始余额'), '1000');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('微信零钱')).toBeInTheDocument();

    // 对话记账（聊天现为全屏弹框，需先点击入口按钮打开）
    await user.click(screen.getByRole('button', { name: '对话' }));
    await user.click(screen.getByRole('button', { name: /输入消息.*记账/ }));
    await user.type(screen.getByLabelText('记账输入'), '吃面25');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText(/已记支出/)).toBeInTheDocument();
    expect(store.state.transactions).toHaveLength(1);

    // 流水页可见（先关闭聊天弹框，再切换到流水 tab）
    await user.click(screen.getByRole('button', { name: '关闭聊天' }));
    await user.click(screen.getByRole('button', { name: '流水' }));
    expect(await screen.findByText('-¥25.00')).toBeInTheDocument();
  });

  it('数据持久化：store.save 后可重新 load', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '账户' }));
    await user.type(await screen.findByLabelText('账户名'), '现金');
    await user.click(screen.getByRole('button', { name: '添加' }));

    const { Store } = await import('../../src/core/store/store');
    const reloaded = new Store();
    expect(reloaded.load()).toBe(true);
    expect(reloaded.state.accounts.some((a) => a.name === '现金')).toBe(true);
  });

  it('还款日进入聊天自动提示并支持选账户还款', async () => {
    const user = userEvent.setup();
    const today = new Date().toISOString().slice(0, 10);
    store.addAccount({ name: '微信零钱', type: 'wallet', balance: 50000 });
    store.addAccount({
      name: '房贷', type: 'loan', balance: 120000,
      meta: {
        kind: 'loan', principal: 120000, annualRate: 0.06, termMonths: 12,
        startDate: '2026-06-15', repaymentMethod: 'equal_interest',
        monthlyPayment: 10327.93, autoDeduct: false, paidMonths: 0, dueDay: 15, nextDueDate: today,
      },
    });
    render(<App />);
    await user.click(screen.getByRole('button', { name: '对话' }));
    await user.click(screen.getByRole('button', { name: /输入消息.*记账/ }));

    // 进入聊天即出现还款日提示与付款账户选项
    expect(await screen.findByText(/今天是你的「房贷」还款日/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '微信零钱' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂不记录' })).toBeInTheDocument();

    // 选择付款账户 → 添加还款流水、扣减账户余额、冲减贷款本金
    await user.click(screen.getByRole('button', { name: '微信零钱' }));
    expect(await screen.findByText(/已记录还款/)).toBeInTheDocument();
    expect(store.state.transactions.some((t) => t.type === 'repayment')).toBe(true);

    const loan = store.state.accounts.find((a) => a.name === '房贷')!;
    const wallet = store.state.accounts.find((a) => a.name === '微信零钱')!;
    expect(loan.balance).toBeLessThan(120000);
    expect(wallet.balance).toBeCloseTo(50000 - 10327.93, 2);
  });

  it('还款提示选择「暂不记录」不产生流水', async () => {
    const user = userEvent.setup();
    const today = new Date().toISOString().slice(0, 10);
    store.addAccount({ name: '微信零钱', type: 'wallet', balance: 50000 });
    store.addAccount({
      name: '房贷', type: 'loan', balance: 120000,
      meta: {
        kind: 'loan', principal: 120000, annualRate: 0.06, termMonths: 12,
        startDate: '2026-06-15', repaymentMethod: 'equal_interest',
        monthlyPayment: 10327.93, autoDeduct: false, paidMonths: 0, dueDay: 15, nextDueDate: today,
      },
    });
    render(<App />);
    await user.click(screen.getByRole('button', { name: '对话' }));
    await user.click(screen.getByRole('button', { name: /输入消息.*记账/ }));
    await screen.findByText(/今天是你的「房贷」还款日/);
    await user.click(screen.getByRole('button', { name: '暂不记录' }));
    expect(await screen.findByText(/已跳过「房贷」本期还款/)).toBeInTheDocument();
    expect(store.state.transactions).toHaveLength(0);
    expect(store.state.accounts.find((a) => a.name === '微信零钱')!.balance).toBe(50000);
  });
});
