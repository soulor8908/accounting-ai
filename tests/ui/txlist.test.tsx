import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TxListView } from '../../src/ui/TxListView';
import { DialogContainer } from '../../src/ui/Dialog';
import { store } from '../../src/ui/appState';

/** 渲染流水页 + 对话框容器（toast/confirm 依赖） */
function renderTxList() {
  return render(
    <>
      <TxListView />
      <DialogContainer />
    </>,
  );
}

/** 当前 YYYY-MM，用于构造本月流水（与组件默认月份筛选一致） */
function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

describe('TxListView 筛选', () => {
  let walletId: string;
  let cashId: string;

  beforeEach(() => {
    cleanup();
    store.clearAll();
    const wallet = store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
    const cash = store.addAccount({ name: '现金', type: 'cash', balance: 500 });
    walletId = wallet.id;
    cashId = cash.id;
    const d = `${currentYM()}-15`;
    store.applyTransaction({ type: 'expense', amount: 25, accountId: walletId, category: '餐饮', description: '吃面', date: d });
    store.applyTransaction({ type: 'income', amount: 5000, accountId: cashId, category: '工资', description: '工资', date: d });
    store.applyTransaction({ type: 'transfer', amount: 100, accountId: walletId, relatedAccountId: cashId, category: '转账', description: '转到现金', date: d });
  });

  it('默认展示全部 3 笔', () => {
    renderTxList();
    expect(screen.getByText(/共 3 笔/)).toBeInTheDocument();
  });

  it('点击"更多筛选"展开类型与支付方式下拉，再次点击收起', async () => {
    const user = userEvent.setup();
    renderTxList();
    expect(screen.queryByLabelText('流水类型')).not.toBeInTheDocument();
    const moreBtn = screen.getByRole('button', { name: '更多筛选' });
    expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
    await user.click(moreBtn);
    expect(screen.getByLabelText('流水类型')).toBeInTheDocument();
    expect(screen.getByLabelText('支付方式')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByLabelText('流水类型')).not.toBeInTheDocument();
  });

  it('按流水类型筛选：仅支出', async () => {
    const user = userEvent.setup();
    renderTxList();
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('流水类型'), 'expense');
    expect(screen.getByText(/共 1 笔/)).toBeInTheDocument();
    expect(screen.getByText('吃面')).toBeInTheDocument();
    expect(screen.queryByText('工资')).not.toBeInTheDocument();
    expect(screen.queryByText('转到现金')).not.toBeInTheDocument();
  });

  it('按支付方式筛选：微信零钱命中支出 + 转出', async () => {
    const user = userEvent.setup();
    renderTxList();
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('支付方式'), '微信零钱');
    expect(screen.getByText(/共 2 笔/)).toBeInTheDocument();
    expect(screen.getByText('吃面')).toBeInTheDocument();
    expect(screen.getByText('转到现金')).toBeInTheDocument();
    expect(screen.queryByText('工资')).not.toBeInTheDocument();
  });

  it('支付方式筛选命中转账对手方（现金）', async () => {
    const user = userEvent.setup();
    renderTxList();
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('支付方式'), '现金');
    expect(screen.getByText(/共 2 笔/)).toBeInTheDocument();
    expect(screen.getByText('工资')).toBeInTheDocument();
    expect(screen.getByText('转到现金')).toBeInTheDocument();
  });

  it('类型 + 支付方式组合筛选', async () => {
    const user = userEvent.setup();
    renderTxList();
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('流水类型'), 'transfer');
    await user.selectOptions(screen.getByLabelText('支付方式'), '微信零钱');
    expect(screen.getByText(/共 1 笔/)).toBeInTheDocument();
    expect(screen.getByText('转到现金')).toBeInTheDocument();
  });

  it('收起后高级条件生效时按钮高亮，清除重置全部', async () => {
    const user = userEvent.setup();
    renderTxList();
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('流水类型'), 'income');
    expect(screen.getByText(/共 1 笔/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.getByRole('button', { name: '更多筛选' }).className).toContain('filter-active');
    await user.click(screen.getByRole('button', { name: '清除' }));
    expect(screen.getByText(/共 3 笔/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清除' })).not.toBeInTheDocument();
  });
});

describe('TxListView 编辑支付账户', () => {
  let walletId: string;
  let cashId: string;
  let cardId: string;

  beforeEach(() => {
    cleanup();
    store.clearAll();
    const wallet = store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
    const cash = store.addAccount({ name: '现金', type: 'cash', balance: 500 });
    const card = store.addAccount({ name: '储蓄卡', type: 'debit', balance: 3000 });
    walletId = wallet.id;
    cashId = cash.id;
    cardId = card.id;
    const d = `${currentYM()}-15`;
    store.applyTransaction({ type: 'expense', amount: 100, accountId: walletId, category: '餐饮', description: '午餐', date: d });
    store.applyTransaction({ type: 'transfer', amount: 200, accountId: walletId, relatedAccountId: cashId, category: '转账', description: '转现金', date: d });
  });

  it('编辑普通流水可修改支付账户，余额正确迁移', async () => {
    const user = userEvent.setup();
    renderTxList();
    // 初始：wallet 700（1000-100支出-200转出），card 3000
    expect(store.getAccount(walletId)!.balance).toBe(700);
    expect(store.getAccount(cardId)!.balance).toBe(3000);

    const expenseRow = screen.getByText('午餐').closest('li')!;
    await user.click(within(expenseRow).getByRole('button', { name: '编辑' }));
    await user.selectOptions(screen.getByLabelText('支付账户'), '储蓄卡');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('已保存修改')).toBeInTheDocument();
    const tx = store.state.transactions.find((t) => t.description === '午餐')!;
    expect(tx.accountId).toBe(cardId);
    // wallet 回滚 +100 → 800；card 扣 100 → 2900
    expect(store.getAccount(walletId)!.balance).toBe(800);
    expect(store.getAccount(cardId)!.balance).toBe(2900);
  });

  it('编辑转账流水可同时修改转出与转入账户，两端余额正确迁移', async () => {
    const user = userEvent.setup();
    renderTxList();
    // 初始：wallet 700（1000-100支出-200转出），cash 700（500+200转入），card 3000
    expect(store.getAccount(walletId)!.balance).toBe(700);
    expect(store.getAccount(cashId)!.balance).toBe(700);
    expect(store.getAccount(cardId)!.balance).toBe(3000);

    const transferRow = screen.getByText('转现金').closest('li')!;
    await user.click(within(transferRow).getByRole('button', { name: '编辑' }));
    await user.selectOptions(screen.getByLabelText('支付账户'), '储蓄卡');
    await user.selectOptions(screen.getByLabelText('目标账户'), '现金');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('已保存修改')).toBeInTheDocument();
    const tx = store.state.transactions.find((t) => t.description === '转现金')!;
    expect(tx.accountId).toBe(cardId);
    expect(tx.relatedAccountId).toBe(cashId);
    // 转账从 wallet→cash 迁移到 card→cash：
    // wallet 回滚 +200 → 900；card 扣 200 → 2800；cash 回滚 -200 再 +200 → 700
    expect(store.getAccount(walletId)!.balance).toBe(900);
    expect(store.getAccount(cardId)!.balance).toBe(2800);
    expect(store.getAccount(cashId)!.balance).toBe(700);
  });

  it('转账目标与支付账户相同时阻止保存', async () => {
    const user = userEvent.setup();
    renderTxList();
    const transferRow = screen.getByText('转现金').closest('li')!;
    await user.click(within(transferRow).getByRole('button', { name: '编辑' }));
    // 转账原为 wallet→cash；把支付账户改为现金，与转入账户（现金）相同
    await user.selectOptions(screen.getByLabelText('支付账户'), '现金');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/目标账户不能与支付账户相同/)).toBeInTheDocument();
  });
});
