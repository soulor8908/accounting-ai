import { useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import type { Transaction, TxType } from '../core/types';
import { store } from './appState';

const TYPE_LABEL: Record<TxType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
  repayment: '还款',
  refund: '退款',
  adjustment: '调账',
};

const SIGN: Record<TxType, string> = {
  income: '+',
  refund: '+',
  expense: '-',
  transfer: '↔',
  repayment: '-',
  adjustment: '±',
};

const EDITABLE_TYPES: TxType[] = ['income', 'expense', 'refund', 'adjustment'];

interface EditState {
  id: string;
  description: string;
  amount: string;
  date: string;
  category: string;
}

export function TxListView({ onChanged }: { onChanged?: () => void }) {
  const [month, setMonth] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [tick, setTick] = useState(0);

  const txs = [...store.state.transactions]
    .filter((t) => !month || t.date.startsWith(month))
    .sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));

  const accountName = (id?: string) => (id ? (store.getAccount(id)?.name ?? '?') : '');

  const startEdit = (t: Transaction) => {
    setEditing({
      id: t.id,
      description: t.description || '',
      amount: String(t.amount),
      date: t.date,
      category: t.category || '',
    });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = () => {
    if (!editing) return;
    const amount = Number(editing.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('金额必须为正数');
      return;
    }
    if (!editing.date) {
      alert('请填写日期');
      return;
    }
    store.updateTransaction(editing.id, {
      description: editing.description.trim(),
      amount,
      date: editing.date,
      category: editing.category.trim() || undefined,
    });
    setEditing(null);
    setTick((n) => n + 1);
    onChanged?.();
  };

  const onDelete = (t: Transaction) => {
    if (!window.confirm(`确定删除这笔流水？\n${t.date} ${t.description || t.category} ¥${formatMoney(t.amount)}`)) return;
    store.deleteTransaction(t.id);
    setTick((n) => n + 1);
    onChanged?.();
  };

  // 引用 tick 让 React 重渲染
  void tick;

  return (
    <div className="panel">
      <h2>流水</h2>
      <div className="filter-row">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="按月份筛选" />
        {month && (
          <button type="button" onClick={() => setMonth('')}>
            清除
          </button>
        )}
      </div>
      <ul className="tx-list">
        {txs.length === 0 && <li className="empty">暂无流水，去「对话」页记一笔吧</li>}
        {txs.map((t) => (
          <li key={t.id} className="tx-item tx-item-with-actions">
            {editing && editing.id === t.id ? (
              <div className="tx-edit-form">
                <div className="form-row">
                  <span>描述</span>
                  <input
                    type="text"
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="描述"
                  />
                </div>
                <div className="form-row-inline">
                  <div className="form-row">
                    <span>金额</span>
                    <input
                      type="number"
                      step="0.01"
                      value={editing.amount}
                      onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <span>日期</span>
                    <input
                      type="date"
                      value={editing.date}
                      onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <span>分类</span>
                  <input
                    type="text"
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    placeholder="如：餐饮、交通"
                  />
                </div>
                <div className="edit-actions">
                  <button type="button" onClick={saveEdit} className="btn-primary-sm">保存</button>
                  <button type="button" onClick={cancelEdit} className="btn-sm">取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="tx-main">
                  <span className="tx-desc">{t.description || t.category}</span>
                  <span className="tx-meta">
                    {t.date} · {TYPE_LABEL[t.type]} · {accountName(t.accountId)}
                    {t.relatedAccountId ? ` → ${accountName(t.relatedAccountId)}` : ''}
                    {t.estimated && <span className="tag">估算</span>}
                  </span>
                </div>
                <div className="tx-right">
                  <span className={`tx-amount ${t.type === 'income' || t.type === 'refund' ? 'positive' : 'negative'}`}>
                    {SIGN[t.type]}¥{formatMoney(t.amount)}
                  </span>
                  <div className="tx-actions">
                    <button type="button" className="btn-sm" onClick={() => startEdit(t)}>
                      编辑
                    </button>
                    <button type="button" className="btn-sm danger" onClick={() => onDelete(t)}>
                      删除
                    </button>
                  </div>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="meta">
        共 {txs.length} 笔。
        {!EDITABLE_TYPES.length ? '' : ''}
      </p>
    </div>
  );
}
