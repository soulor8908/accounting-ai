import { useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import type { Transaction, TxType } from '../core/types';
import { store } from './appState';
import { dialog } from './Dialog';
import { SwipeableRow } from './SwipeableRow';

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

/** 可编辑的账户类型：资产类 + 信用卡/分期。贷款流水由系统自动生成，不可编辑（避免破坏派生状态）。 */
const EDITABLE_ACCOUNT_TYPES = new Set(['wallet', 'alipay', 'cash', 'debit', 'credit', 'installment']);

/** 流水是否可编辑：主账户与对手方都不能是贷款账户 */
function isTxEditable(t: Transaction): boolean {
  const main = store.getAccount(t.accountId);
  const related = t.relatedAccountId ? store.getAccount(t.relatedAccountId) : undefined;
  return !!main && EDITABLE_ACCOUNT_TYPES.has(main.type) && (!related || EDITABLE_ACCOUNT_TYPES.has(related.type));
}

/** 当前月份（YYYY-MM），作为流水列表的默认筛选值 */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface EditState {
  id: string;
  description: string;
  amount: string;
  date: string;
  category: string;
  accountId: string;
  relatedAccountId: string; // 仅 transfer/repayment 使用
}

export function TxListView({ onChanged }: { onChanged?: () => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [typeFilter, setTypeFilter] = useState<TxType | ''>('');
  const [accountFilter, setAccountFilter] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [tick, setTick] = useState(0);

  const txs = [...store.state.transactions]
    .filter((t) => !month || t.date.startsWith(month))
    .filter((t) => !typeFilter || t.type === typeFilter)
    .filter((t) => !accountFilter || t.accountId === accountFilter || t.relatedAccountId === accountFilter)
    .sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));

  const advancedActive = Boolean(typeFilter || accountFilter);
  const hasAnyFilter = Boolean(month || typeFilter || accountFilter);

  const clearAll = () => {
    setMonth('');
    setTypeFilter('');
    setAccountFilter('');
  };

  const accountName = (id?: string) => (id ? (store.getAccount(id)?.name ?? '?') : '');

  const startEdit = (t: Transaction) => {
    setEditing({
      id: t.id,
      description: t.description || '',
      amount: String(t.amount),
      date: t.date,
      category: t.category || '',
      accountId: t.accountId,
      relatedAccountId: t.relatedAccountId ?? '',
    });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = async () => {
    if (!editing) return;
    const amount = Number(editing.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      dialog.toast('金额必须为正数', 'error');
      return;
    }
    if (!editing.date) {
      dialog.toast('请填写日期', 'error');
      return;
    }
    if (!editing.accountId) {
      dialog.toast('请选择支付账户', 'error');
      return;
    }
    const origTx = store.state.transactions.find((t) => t.id === editing.id);
    const hasRelated = origTx?.type === 'transfer' || origTx?.type === 'repayment';
    if (hasRelated && !editing.relatedAccountId) {
      dialog.toast('请选择目标账户', 'error');
      return;
    }
    if (hasRelated && editing.relatedAccountId === editing.accountId) {
      dialog.toast('目标账户不能与支付账户相同', 'error');
      return;
    }
    try {
      store.updateTransaction(editing.id, {
        description: editing.description.trim(),
        amount,
        date: editing.date,
        category: editing.category.trim() || undefined,
        accountId: editing.accountId,
        relatedAccountId: hasRelated ? editing.relatedAccountId : undefined,
      });
      setEditing(null);
      setTick((n) => n + 1);
      onChanged?.();
      dialog.toast('已保存修改', 'success');
    } catch (err) {
      dialog.toast(err instanceof Error ? err.message : '保存失败', 'error');
    }
  };

  const onDelete = async (t: Transaction) => {
    const ok = await dialog.confirm(
      `确定删除这笔流水？\n${t.date} ${t.description || t.category} ¥${formatMoney(t.amount)}`,
      '删除流水',
    );
    if (!ok) return;
    store.deleteTransaction(t.id);
    setTick((n) => n + 1);
    onChanged?.();
    dialog.toast('流水已删除', 'success');
  };

  // 引用 tick 让 React 重渲染
  void tick;

  return (
    <div className="panel">
      <h2>流水</h2>
      <div className="filter-row">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="按月份筛选" />
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          aria-controls="tx-filter-advanced"
          className={advancedActive && !showAdvanced ? 'filter-active' : ''}
        >
          {showAdvanced ? '收起' : '更多筛选'}
        </button>
        {hasAnyFilter && (
          <button type="button" onClick={clearAll}>
            清除
          </button>
        )}
      </div>
      {showAdvanced && (
        <div className="filter-row filter-advanced" id="tx-filter-advanced">
          <select
            aria-label="流水类型"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TxType | '')}
          >
            <option value="">全部类型</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            aria-label="支付方式"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
          >
            <option value="">全部支付方式</option>
            {store.state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ul className="tx-list">
        {txs.length === 0 && <li className="empty">暂无流水，去「对话」页记一笔吧</li>}
        {txs.map((t) => (
          <li key={t.id}>
            {editing && editing.id === t.id ? (
              <div className="tx-item">
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
                  <div className="form-row">
                    <span>支付账户</span>
                    <select
                      aria-label="支付账户"
                      value={editing.accountId}
                      onChange={(e) => setEditing({ ...editing, accountId: e.target.value })}
                    >
                      {store.state.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(() => {
                    const origTx = store.state.transactions.find((t) => t.id === editing.id);
                    if (origTx?.type !== 'transfer' && origTx?.type !== 'repayment') return null;
                    return (
                      <div className="form-row">
                        <span>{origTx.type === 'transfer' ? '转入账户' : '还款账户'}</span>
                        <select
                          aria-label="目标账户"
                          value={editing.relatedAccountId}
                          onChange={(e) => setEditing({ ...editing, relatedAccountId: e.target.value })}
                        >
                          {store.state.accounts
                            .filter((a) => a.id !== editing.accountId)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    );
                  })()}
                  <div className="edit-actions">
                    <button type="button" onClick={saveEdit} className="btn-primary-sm">保存</button>
                    <button type="button" onClick={cancelEdit} className="btn-sm">取消</button>
                  </div>
                </div>
              </div>
            ) : (
              <SwipeableRow
                actions={
                  <>
                    {isTxEditable(t) && <button type="button" className="act-edit" onClick={() => startEdit(t)}>编辑</button>}
                    <button type="button" className="act-delete" onClick={() => onDelete(t)}>删除</button>
                  </>
                }
              >
                <div className="tx-item">
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
                </div>
              </SwipeableRow>
            )}
          </li>
        ))}
      </ul>
      <p className="meta">
        共 {txs.length} 笔。
      </p>
    </div>
  );
}
