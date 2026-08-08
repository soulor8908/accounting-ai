import { useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { ValidationError } from '../core/store/store';
import type { AccountType, Transaction, TxType } from '../core/types';
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

/** 手动可操作的账户类型：资产类 + 信用卡/分期。贷款流水由系统自动生成，不可手动新增/编辑。 */
const SELECTABLE_ACCOUNT_TYPES: AccountType[] = ['wallet', 'alipay', 'cash', 'debit', 'credit', 'installment'];
const SELECTABLE_SET = new Set(SELECTABLE_ACCOUNT_TYPES);
/** 还款目标账户类型：信用卡/分期（贷款还款走周期规则，不手动新增） */
const REPAYMENT_TARGET_TYPES: AccountType[] = ['credit', 'installment'];

/** 流水是否可编辑：主账户与对手方都不能是贷款账户，且不能是已注销账户 */
function isTxEditable(t: Transaction): boolean {
  const main = store.getAccount(t.accountId);
  const related = t.relatedAccountId ? store.getAccount(t.relatedAccountId) : undefined;
  return !!main && !main.archived && SELECTABLE_SET.has(main.type) && (!related || (!related.archived && SELECTABLE_SET.has(related.type)));
}

/** 当前月份（YYYY-MM），作为流水列表的默认筛选值 */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 今日日期（YYYY-MM-DD），作为新增流水的默认日期 */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

/** 手动新增流水表单状态 */
interface AddState {
  type: TxType;
  amount: string;
  accountId: string;
  relatedAccountId: string; // transfer/repayment 使用
  date: string;
  category: string;
  description: string;
}

const ADD_TYPES: TxType[] = ['expense', 'income', 'transfer', 'repayment', 'refund', 'adjustment'];

function emptyAddState(): AddState {
  const first = store.state.accounts.find((a) => !a.archived && SELECTABLE_SET.has(a.type));
  return {
    type: 'expense',
    amount: '',
    accountId: first?.id ?? '',
    relatedAccountId: '',
    date: today(),
    category: '',
    description: '',
  };
}

export function TxListView({ onChanged }: { onChanged?: () => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [typeFilter, setTypeFilter] = useState<TxType | ''>('');
  const [accountFilter, setAccountFilter] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [adding, setAdding] = useState<AddState | null>(null);
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

  /** 提交新增流水。超额/余额不足/大额会弹确认框；其他错误 toast 提示。 */
  const submitAdd = async (force = false) => {
    if (!adding) return;
    const amount = Number(adding.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      dialog.toast('金额必须为正数', 'error');
      return;
    }
    if (!adding.date) {
      dialog.toast('请填写日期', 'error');
      return;
    }
    if (!adding.accountId) {
      dialog.toast('请选择支付账户', 'error');
      return;
    }
    const needRelated = adding.type === 'transfer' || adding.type === 'repayment';
    if (needRelated && !adding.relatedAccountId) {
      dialog.toast(adding.type === 'transfer' ? '请选择转入账户' : '请选择还款账户', 'error');
      return;
    }
    if (needRelated && adding.relatedAccountId === adding.accountId) {
      dialog.toast('目标账户不能与支付账户相同', 'error');
      return;
    }
    try {
      store.applyTransaction(
        {
          type: adding.type,
          amount,
          accountId: adding.accountId,
          relatedAccountId: needRelated ? adding.relatedAccountId : undefined,
          date: adding.date,
          category: adding.category.trim() || undefined,
          description: adding.description.trim() || undefined,
        },
        { confirm: force, skipDuplicateCheck: true },
      );
      setAdding(null);
      setTick((n) => n + 1);
      onChanged?.();
      dialog.toast('已新增流水', 'success');
    } catch (err) {
      if (err instanceof ValidationError) {
        // 超额/余额不足直接失败（手动录入明确金额，超额即出错）；仅大额可确认
        const hardFail = err.issues.some((i) => i.code === 'overdraft' || i.code === 'limit_exceeded');
        const confirmable = !hardFail && err.issues.some((i) => i.code === 'large_amount');
        if (confirmable && !force) {
          const ok = await dialog.confirm(`${err.message}\n\n确认新增吗？`, '大额确认');
          if (ok) return submitAdd(true);
          return;
        }
      }
      dialog.toast(err instanceof Error ? err.message : '新增失败', 'error');
    }
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
      <div className="filter-row">
        <button type="button" className="tx-add-btn" onClick={() => setAdding(emptyAddState())}>
          + 记一笔
        </button>
      </div>
      {adding && (
        <div className="tx-add-form">
          <div className="form-row-inline">
            <div className="form-row">
              <span>类型</span>
              <select
                aria-label="流水类型"
                value={adding.type}
                onChange={(e) => {
                  const type = e.target.value as TxType;
                  // 切换类型时重置对手方（仅 transfer/repayment 需要）
                  setAdding({ ...adding, type, relatedAccountId: '' });
                }}
              >
                {ADD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <span>金额</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={adding.amount}
                onChange={(e) => setAdding({ ...adding, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="form-row">
              <span>日期</span>
              <input type="date" value={adding.date} onChange={(e) => setAdding({ ...adding, date: e.target.value })} />
            </div>
          </div>
          <div className="form-row-inline">
            <div className="form-row">
              <span>{adding.type === 'repayment' ? '还款账户' : '支付账户'}</span>
              <select
                aria-label="支付账户"
                value={adding.accountId}
                onChange={(e) => setAdding({ ...adding, accountId: e.target.value })}
              >
                {store.state.accounts
                  .filter((a) => !a.archived && SELECTABLE_SET.has(a.type))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
            {adding.type === 'transfer' && (
              <div className="form-row">
                <span>转入账户</span>
                <select
                  aria-label="转入账户"
                  value={adding.relatedAccountId}
                  onChange={(e) => setAdding({ ...adding, relatedAccountId: e.target.value })}
                >
                  <option value="">请选择</option>
                  {store.state.accounts
                    .filter((a) => !a.archived && SELECTABLE_SET.has(a.type) && a.id !== adding.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {adding.type === 'repayment' && (
              <div className="form-row">
                <span>还款账户</span>
                <select
                  aria-label="还款账户"
                  value={adding.relatedAccountId}
                  onChange={(e) => setAdding({ ...adding, relatedAccountId: e.target.value })}
                >
                  <option value="">请选择</option>
                  {store.state.accounts
                    .filter((a) => !a.archived && REPAYMENT_TARGET_TYPES.includes(a.type) && a.id !== adding.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
          <div className="form-row-inline">
            <div className="form-row">
              <span>分类</span>
              <input
                type="text"
                value={adding.category}
                onChange={(e) => setAdding({ ...adding, category: e.target.value })}
                placeholder="如：餐饮、交通"
              />
            </div>
            <div className="form-row">
              <span>描述</span>
              <input
                type="text"
                value={adding.description}
                onChange={(e) => setAdding({ ...adding, description: e.target.value })}
                placeholder="可选"
              />
            </div>
          </div>
          <div className="edit-actions">
            <button type="button" className="btn-primary-sm" onClick={() => submitAdd()}>
              保存
            </button>
            <button type="button" className="btn-sm" onClick={() => setAdding(null)}>
              取消
            </button>
          </div>
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
