import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountsView } from '../../src/ui/AccountsView';
import { DialogContainer } from '../../src/ui/Dialog';
import { store } from '../../src/ui/appState';

/** AccountsView 依赖 onChanged 触发重渲染，用 Harness 包裹模拟父组件刷新 */
function renderAccounts() {
  function Harness() {
    const [, setN] = useState(0);
    return (
      <>
        <AccountsView onChanged={() => setN((v) => v + 1)} />
        <DialogContainer />
      </>
    );
  }
  return render(<Harness />);
}

describe('AccountsView 注销', () => {
  beforeEach(() => {
    cleanup();
    store.clearAll();
  });

  it('删除有流水的账户：提示改为注销，确认后余额归零且不再统计', async () => {
    const user = userEvent.setup();
    const wallet = store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
    store.applyTransaction({ type: 'expense', amount: 100, accountId: wallet.id, category: '餐饮', date: '2026-07-15' });
    renderAccounts();

    expect(store.getTotalAssets()).toBe(900);
    await user.click(screen.getByRole('button', { name: '删除' }));
    // 第一个确认框：删除账户
    expect(await screen.findByText('删除账户')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确定' }));
    // 第二个确认框：改为注销
    expect(await screen.findByText('改为注销')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(await screen.findByText('账户已注销')).toBeInTheDocument();
    expect(store.getAccount(wallet.id)!.archived).toBe(true);
    expect(store.getAccount(wallet.id)!.balance).toBe(0);
    // 不再计入统计
    expect(store.getTotalAssets()).toBe(0);
    // 历史流水保留
    expect(store.state.transactions).toHaveLength(1);
    // 已停用折叠区出现
    expect(screen.getByText(/已停用账户/)).toBeInTheDocument();
  });

  it('删除有流水的账户：取消注销则账户不变', async () => {
    const user = userEvent.setup();
    const wallet = store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
    store.applyTransaction({ type: 'expense', amount: 100, accountId: wallet.id, category: '餐饮', date: '2026-07-15' });
    renderAccounts();

    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确定' })); // 删除账户
    expect(await screen.findByText('改为注销')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' })); // 取消注销

    expect(store.getAccount(wallet.id)!.archived).toBeUndefined();
    expect(store.getAccount(wallet.id)!.balance).toBe(900);
  });

  it('删除无流水的账户：直接删除，不弹注销确认', async () => {
    const user = userEvent.setup();
    store.addAccount({ name: '现金', type: 'cash', balance: 500 });
    renderAccounts();

    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确定' })); // 删除账户
    expect(await screen.findByText('账户已删除')).toBeInTheDocument();
    // 没有弹出"改为注销"框
    expect(screen.queryByText('改为注销')).not.toBeInTheDocument();
    expect(store.state.accounts).toHaveLength(0);
  });
});
