import { useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import type { TxType } from '../core/types';
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

export function TxListView() {
  const [month, setMonth] = useState('');
  const txs = [...store.state.transactions]
    .filter((t) => !month || t.date.startsWith(month))
    .sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));

  const accountName = (id?: string) => (id ? (store.getAccount(id)?.name ?? '?') : '');

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
          <li key={t.id} className="tx-item">
            <div className="tx-main">
              <span className="tx-desc">{t.description || t.category}</span>
              <span className="tx-meta">
                {t.date} · {TYPE_LABEL[t.type]} · {accountName(t.accountId)}
                {t.relatedAccountId ? ` → ${accountName(t.relatedAccountId)}` : ''}
                {t.estimated && <span className="tag">估算</span>}
              </span>
            </div>
            <span className={`tx-amount ${t.type === 'income' || t.type === 'refund' ? 'positive' : 'negative'}`}>
              {SIGN[t.type]}¥{formatMoney(t.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
