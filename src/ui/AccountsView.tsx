import { type FormEvent, useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { ValidationError } from '../core/store/store';
import type { Account, AccountMeta, AccountType, RepaymentMethod } from '../core/types';
import { round2 } from '../core/utils/money';
import { calcMonthlyPayment, addMonthsClamped } from '../core/finance/loan';
import { store } from './appState';
import { dialog } from './Dialog';
import { SwipeableRow } from './SwipeableRow';

const TYPE_LABEL: Record<AccountType, string> = {
  wallet: '电子钱包',
  alipay: '支付宝',
  cash: '现金',
  debit: '储蓄卡',
  credit: '信用卡',
  loan: '贷款',
  installment: '白条/花呗',
};

function clampDay(v: string, fallback = 20): number {
  return Math.min(31, Math.max(1, Number(v) || fallback));
}

export function AccountsView({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('wallet');
  const [balance, setBalance] = useState('');
  const [limit, setLimit] = useState('');
  const [billDay, setBillDay] = useState('1');
  const [dueDay, setDueDay] = useState('20');
  const [dueNextMonth, setDueNextDay] = useState(false);
  // 贷款专属字段
  const [principal, setPrincipal] = useState('');
  const [annualRate, setAnnualRate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [startDate, setStartDate] = useState('');
  const [repaymentMethod, setRepaymentMethod] = useState<RepaymentMethod>('equal_interest');
  const [loanDueDay, setLoanDueDay] = useState('20');
  const [error, setError] = useState('');

  // 编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [editLimit, setEditLimit] = useState('');
  const [editBillDay, setEditBillDay] = useState('');
  const [editDueDay, setEditDueDay] = useState('');
  const [editDueNextDay, setEditDueNextDay] = useState(false);
  // 贷款编辑字段
  const [editPrincipal, setEditPrincipal] = useState('');
  const [editAnnualRate, setEditAnnualRate] = useState('');
  const [editTermMonths, setEditTermMonths] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editRepaymentMethod, setEditRepaymentMethod] = useState<RepaymentMethod>('equal_interest');
  const [editLoanDueDay, setEditLoanDueDay] = useState('');
  const [editError, setEditError] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      let meta: AccountMeta | undefined;
      let initialBalance = Number(balance) || 0;
      if (type === 'credit') {
        meta = {
          kind: 'credit',
          limit: Number(limit) || 0,
          billDay: clampDay(billDay, 1),
          dueDay: clampDay(dueDay, 20),
          dueNextMonth,
        };
      } else if (type === 'installment') {
        meta = { kind: 'installment', totalLimit: Number(limit) || 0 };
      } else if (type === 'loan') {
        const p = Number(principal) || 0;
        const rate = Number(annualRate) || 0;
        const term = Math.max(1, Math.min(360, Number(termMonths) || 1));
        const start = startDate || new Date().toISOString().slice(0, 10);
        const dd = clampDay(loanDueDay, 20);
        // 计算月供
        let monthly = 0;
        if (p > 0 && term > 0) {
          if (repaymentMethod === 'interest_only') {
            monthly = round2(p * rate / 12);
          } else if (repaymentMethod === 'equal_interest') {
            const r = rate / 12;
            monthly = r > 0 ? round2(p * r * Math.pow(1 + r, term) / (Math.pow(1 + r, term) - 1)) : round2(p / term);
          } else {
            const r = rate / 12;
            monthly = round2(p / term + p * r);
          }
        }
        meta = {
          kind: 'loan',
          principal: p,
          annualRate: rate,
          termMonths: term,
          startDate: start,
          repaymentMethod,
          monthlyPayment: monthly,
          autoDeduct: false,
          paidMonths: 0,
          dueDay: dd,
          nextDueDate: start,
        };
        initialBalance = p;
      }
      store.addAccount({ name, type, balance: initialBalance, meta });
      setName('');
      setBalance('');
      setLimit('');
      setPrincipal('');
      setAnnualRate('');
      setTermMonths('');
      setStartDate('');
      setDueNextDay(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : '创建失败');
    }
  };

  const startEdit = (acc: Account) => {
    setEditingId(acc.id);
    setEditName(acc.name);
    setEditBalance(String(acc.balance));
    setEditError('');
    if (acc.meta?.kind === 'credit') {
      setEditLimit(String(acc.meta.limit));
      setEditBillDay(String(acc.meta.billDay));
      setEditDueDay(String(acc.meta.dueDay));
      setEditDueNextDay(acc.meta.dueNextMonth ?? false);
    } else if (acc.meta?.kind === 'installment') {
      setEditLimit(String(acc.meta.totalLimit));
    } else if (acc.meta?.kind === 'loan') {
      setEditPrincipal(String(acc.meta.principal));
      setEditAnnualRate(String(acc.meta.annualRate));
      setEditTermMonths(String(acc.meta.termMonths));
      setEditStartDate(acc.meta.startDate);
      setEditRepaymentMethod(acc.meta.repaymentMethod);
      setEditLoanDueDay(String(acc.meta.dueDay));
    }
  };

  const saveEdit = (acc: Account) => {
    setEditError('');
    try {
      const patch: Partial<Account> = {
        name: editName.trim() || acc.name,
        balance: round2(Number(editBalance) || 0),
      };
      if (acc.meta?.kind === 'credit') {
        patch.meta = {
          ...acc.meta,
          limit: Number(editLimit) || acc.meta.limit,
          billDay: clampDay(editBillDay, acc.meta.billDay),
          dueDay: clampDay(editDueDay, acc.meta.dueDay),
          dueNextMonth: editDueNextDay,
        };
      } else if (acc.meta?.kind === 'installment') {
        patch.meta = { ...acc.meta, totalLimit: Number(editLimit) || acc.meta.totalLimit };
      } else if (acc.meta?.kind === 'loan') {
        const oldMeta = acc.meta;
        const p = Number(editPrincipal) || oldMeta.principal;
        const rate = Number(editAnnualRate) || oldMeta.annualRate;
        const term = Math.max(1, Math.min(360, Number(editTermMonths) || oldMeta.termMonths));
        const start = editStartDate || oldMeta.startDate;
        const dd = clampDay(editLoanDueDay, oldMeta.dueDay);
        const method = editRepaymentMethod;

        // 重新计算月供
        const monthly = calcMonthlyPayment(p, rate, term, method);

        const paidMonths = Math.min(oldMeta.paidMonths, term);
        // 下期还款日保持不变（除非改了放款日或期数少于已还月数）
        let nextDueDate = oldMeta.nextDueDate;
        if (start !== oldMeta.startDate) {
          nextDueDate = addMonthsClamped(start, 1);
        }
        if (paidMonths >= term) {
          nextDueDate = oldMeta.nextDueDate;
        }

        patch.meta = {
          ...oldMeta,
          principal: p,
          annualRate: rate,
          termMonths: term,
          startDate: start,
          repaymentMethod: method,
          monthlyPayment: monthly,
          paidMonths,
          dueDay: dd,
          nextDueDate,
        };

        // 同步更新关联的周期规则（如贷款月供自动扣款规则）
        for (const rule of store.state.recurringRules) {
          if (rule.relatedAccountId === acc.id && rule.type === 'repayment') {
            store.updateRecurringRule(rule.id, { amount: monthly });
          }
        }
      }
      store.updateAccount(acc.id, patch);
      setEditingId(null);
      onChanged();
    } catch (err) {
      setEditError(err instanceof ValidationError ? err.message : '保存失败');
    }
  };

  const deleteAccount = async (acc: Account) => {
    setEditError('');
    const ok = await dialog.confirm(
      `确定删除账户「${acc.name}」？\n余额 ¥${formatMoney(acc.balance)}，删除后无法恢复。`,
      '删除账户',
    );
    if (!ok) return;
    try {
      store.removeAccount(acc.id);
      setEditingId(null);
      onChanged();
      dialog.toast('账户已删除', 'success');
    } catch (err) {
      const msg = err instanceof ValidationError ? err.message : '删除失败';
      setEditError(msg);
      dialog.toast(msg, 'error');
    }
  };

  const isEditing = (acc: Account) => editingId === acc.id;

  return (
    <div className="panel">
      <h2>账户</h2>
      <ul className="account-list">
        {store.state.accounts.map((a) => (
          <li key={a.id}>
            {isEditing(a) ? (
              <div className="account-item">
                <div className="account-edit-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="账户名" aria-label="编辑账户名" />
                  <input value={editBalance} onChange={(e) => setEditBalance(e.target.value)} placeholder="余额" inputMode="decimal" aria-label="编辑余额" />
                  {a.meta?.kind === 'credit' && (
                    <>
                      <input value={editLimit} onChange={(e) => setEditLimit(e.target.value)} placeholder="额度" inputMode="decimal" aria-label="编辑额度" />
                      <input value={editBillDay} onChange={(e) => setEditBillDay(e.target.value)} placeholder="账单日" inputMode="numeric" aria-label="编辑账单日" />
                      {!editDueNextDay && (
                        <input value={editDueDay} onChange={(e) => setEditDueDay(e.target.value)} placeholder="还款日" inputMode="numeric" aria-label="编辑还款日" />
                      )}
                      <label className="check-row">
                        <input type="checkbox" checked={editDueNextDay} onChange={(e) => setEditDueNextDay(e.target.checked)} />
                        <span>还款日在次月</span>
                      </label>
                    </>
                  )}
                  {a.meta?.kind === 'installment' && (
                    <input value={editLimit} onChange={(e) => setEditLimit(e.target.value)} placeholder="总额度" inputMode="decimal" aria-label="编辑总额度" />
                  )}
                  {a.meta?.kind === 'loan' && (
                    <>
                      <input value={editPrincipal} onChange={(e) => setEditPrincipal(e.target.value)} placeholder="贷款本金" inputMode="decimal" aria-label="编辑贷款本金" />
                      <input value={editAnnualRate} onChange={(e) => setEditAnnualRate(e.target.value)} placeholder="年利率（如 0.049）" inputMode="decimal" aria-label="编辑年利率" />
                      <input value={editTermMonths} onChange={(e) => setEditTermMonths(e.target.value)} placeholder="期数（月）" inputMode="numeric" aria-label="编辑期数" />
                      <input value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} type="date" aria-label="编辑放款日" />
                      <select value={editRepaymentMethod} onChange={(e) => setEditRepaymentMethod(e.target.value as RepaymentMethod)} aria-label="编辑还款方式">
                        <option value="equal_interest">等额本息</option>
                        <option value="equal_principal">等额本金</option>
                        <option value="interest_only">先息后本</option>
                      </select>
                      <input value={editLoanDueDay} onChange={(e) => setEditLoanDueDay(e.target.value)} placeholder="每月还款日（1-31）" inputMode="numeric" aria-label="编辑每月还款日" />
                    </>
                  )}
                  <div className="edit-actions">
                    <button type="button" className="btn-sm" onClick={() => saveEdit(a)}>保存</button>
                    <button type="button" className="btn-sm" onClick={() => setEditingId(null)}>取消</button>
                  </div>
                  {editError && <p className="error-text">{editError}</p>}
                </div>
              </div>
            ) : (
              <SwipeableRow
                actions={
                  <>
                    <button type="button" className="act-edit" onClick={() => startEdit(a)}>编辑</button>
                    <button type="button" className="act-delete" onClick={() => deleteAccount(a)}>删除</button>
                  </>
                }
              >
                <div className="account-item">
                  <div className="account-info">
                    <strong>{a.name}</strong>
                    <span className="tag">{TYPE_LABEL[a.type]}</span>
                    {a.meta?.kind === 'credit' && (
                      <span className="meta">
                        额度 ¥{formatMoney(a.meta.limit)} · 账单日 {a.meta.billDay} 号 · 还款日 {a.meta.dueNextMonth ? `次月${a.meta.dueDay}号` : `${a.meta.dueDay} 号`}
                      </span>
                    )}
                    {a.meta?.kind === 'installment' && <span className="meta">总额度 ¥{formatMoney(a.meta.totalLimit)}</span>}
                    {a.meta?.kind === 'loan' && (
                      <span className="meta">
                        月供 ¥{formatMoney(a.meta.monthlyPayment)} · 年利率 {(a.meta.annualRate * 100).toFixed(2)}% · 下期 {a.meta.nextDueDate}
                      </span>
                    )}
                  </div>
                  <div className="account-right">
                    <span className={a.type === 'credit' || a.type === 'loan' || a.type === 'installment' ? 'negative' : ''}>
                      ¥{formatMoney(a.balance)}
                    </span>
                  </div>
                </div>
              </SwipeableRow>
            )}
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
        {type !== 'loan' && (
          <input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="初始余额" inputMode="decimal" aria-label="初始余额" />
        )}
        {(type === 'credit' || type === 'installment') && (
          <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="额度" inputMode="decimal" aria-label="额度" />
        )}
        {type === 'credit' && (
          <>
            <input value={billDay} onChange={(e) => setBillDay(e.target.value)} placeholder="账单日（1-31）" inputMode="numeric" aria-label="账单日" />
            {!dueNextMonth && (
              <input value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="还款日（1-31）" inputMode="numeric" aria-label="还款日" />
            )}
            <label className="check-row">
              <input type="checkbox" checked={dueNextMonth} onChange={(e) => setDueNextDay(e.target.checked)} />
              <span>还款日在次月</span>
            </label>
          </>
        )}
        {type === 'loan' && (
          <>
            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="贷款本金" inputMode="decimal" aria-label="贷款本金" />
            <input value={annualRate} onChange={(e) => setAnnualRate(e.target.value)} placeholder="年利率（如 0.049 表示 4.9%）" inputMode="decimal" aria-label="年利率" />
            <input value={termMonths} onChange={(e) => setTermMonths(e.target.value)} placeholder="期数（月）" inputMode="numeric" aria-label="期数" />
            <input
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              type="date"
              aria-label="放款日"
            />
            <select value={repaymentMethod} onChange={(e) => setRepaymentMethod(e.target.value as RepaymentMethod)} aria-label="还款方式">
              <option value="equal_interest">等额本息</option>
              <option value="equal_principal">等额本金</option>
              <option value="interest_only">先息后本</option>
            </select>
            <input value={loanDueDay} onChange={(e) => setLoanDueDay(e.target.value)} placeholder="每月还款日（1-31）" inputMode="numeric" aria-label="每月还款日" />
          </>
        )}
        <button type="submit">添加</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
