import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TxListView } from '../../src/ui/TxListView';
import { store } from '../../src/ui/appState';

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
    render(<TxListView />);
    expect(screen.getByText(/共 3 笔/)).toBeInTheDocument();
  });

  it('点击"更多筛选"展开类型与支付方式下拉，再次点击收起', async () => {
    const user = userEvent.setup();
    render(<TxListView />);
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
    render(<TxListView />);
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('流水类型'), 'expense');
    expect(screen.getByText(/共 1 笔/)).toBeInTheDocument();
    expect(screen.getByText('吃面')).toBeInTheDocument();
    expect(screen.queryByText('工资')).not.toBeInTheDocument();
    expect(screen.queryByText('转到现金')).not.toBeInTheDocument();
  });

  it('按支付方式筛选：微信零钱命中支出 + 转出', async () => {
    const user = userEvent.setup();
    render(<TxListView />);
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('支付方式'), '微信零钱');
    expect(screen.getByText(/共 2 笔/)).toBeInTheDocument();
    expect(screen.getByText('吃面')).toBeInTheDocument();
    expect(screen.getByText('转到现金')).toBeInTheDocument();
    expect(screen.queryByText('工资')).not.toBeInTheDocument();
  });

  it('支付方式筛选命中转账对手方（现金）', async () => {
    const user = userEvent.setup();
    render(<TxListView />);
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('支付方式'), '现金');
    expect(screen.getByText(/共 2 笔/)).toBeInTheDocument();
    expect(screen.getByText('工资')).toBeInTheDocument();
    expect(screen.getByText('转到现金')).toBeInTheDocument();
  });

  it('类型 + 支付方式组合筛选', async () => {
    const user = userEvent.setup();
    render(<TxListView />);
    await user.click(screen.getByRole('button', { name: '更多筛选' }));
    await user.selectOptions(screen.getByLabelText('流水类型'), 'transfer');
    await user.selectOptions(screen.getByLabelText('支付方式'), '微信零钱');
    expect(screen.getByText(/共 1 笔/)).toBeInTheDocument();
    expect(screen.getByText('转到现金')).toBeInTheDocument();
  });

  it('收起后高级条件生效时按钮高亮，清除重置全部', async () => {
    const user = userEvent.setup();
    render(<TxListView />);
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
