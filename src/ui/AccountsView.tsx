import { type FormEvent, useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { ValidationError } from '../core/store/store';
import type { AccountMeta, AccountType } from '../core/types';
import { store } from './appState';

const TYPE_LABEL: Record<AccountType, string> = {
  wallet: '电子钱包',
  alipay: '支付宝',
  cash: '现金',
  debit: '储蓄卡',
  credit: '信用卡',
  loan: '贷款',
  installment: '白条/花呗',
};

export function AccountsView({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('wallet');
  const [balance, setBalance] = useState('');
  const [limit, setLimit] = useState('');
  const [billDay, setBillDay] = useState('1');
  const [dueDay, setDueDay] = useState('20');
  const [error, setError] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      let meta: AccountMeta | undefined;
      if (type === 'credit') {
        meta = {
          kind: 'credit',
          limit: Number(limit) || 0,
          billDay: Math.min(28, Math.max(1, Number(billDay) || 1)),
          dueDay: Math.min(28, Math.max(1, Number(dueDay) || 20)),
        };
      } else if (type === 'installment') {
        meta = { kind: 'installment', totalLimit: Number(limit) || 0 };
      }
      store.addAccount({ name, type, balance: Number(balance) || 0, meta });
      setName('');
      setBalance('');
      setLimit('');
      onChanged();
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : '创建失败');
    }
  };

  return (
    <div className="panel">
      <h2>账户</h2>
      <ul className="account-list">
        {store.state.accounts.map((a) => (
          <li key={a.id} className="account-item">
            <div>
              <strong>{a.name}</strong>
              <span className="tag">{TYPE_LABEL[a.type]}</span>
              {a.meta?.kind === 'credit' && (
                <span className="meta">
                  额度 ¥{formatMoney(a.meta.limit)} · 账单日 {a.meta.billDay} 号 · 还款日 {a.meta.dueDay} 号
                </span>
              )}
              {a.meta?.kind === 'installment' && <span className="meta">总额度 ¥{formatMoney(a.meta.totalLimit)}</span>}
              {a.meta?.kind === 'loan' && (
                <span className="meta">
                  月供 ¥{formatMoney(a.meta.monthlyPayment)} · 年利率 {(a.meta.annualRate * 100).toFixed(2)}% · 下期 {a.meta.nextDueDate}
                </span>
              )}
            </div>
            <span className={a.type === 'credit' || a.type === 'loan' || a.type === 'installment' ? 'negative' : ''}>
              ¥{formatMoney(a.balance)}
            </span>
          </li>
        ))}
        {store.state.accounts.length === 0 && <li className="empty">还没有账户，先在下方添加一个吧</li>}
      </ul>

      <h3>添加账户</h3>
      <form className="account-form" onSubmit={onSubmit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="账户名，如 微信零钱" required aria-label="账户名" />
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)} aria-label="账户类型">
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="初始余额" inputMode="decimal" aria-label="初始余额" />
        {(type === 'credit' || type === 'installment') && (
          <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="额度" inputMode="decimal" aria-label="额度" />
        )}
        {type === 'credit' && (
          <>
            <input value={billDay} onChange={(e) => setBillDay(e.target.value)} placeholder="账单日" inputMode="numeric" aria-label="账单日" />
            <input value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="还款日" inputMode="numeric" aria-label="还款日" />
          </>
        )}
        <button type="submit">添加</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
