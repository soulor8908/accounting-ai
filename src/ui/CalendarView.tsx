import { type TouchEvent, useMemo, useRef, useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import type { Transaction } from '../core/types';
import { store } from './appState';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const TX_TYPE_LABEL: Record<string, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
  repayment: '还款',
  refund: '退款',
  adjustment: '调账',
};

export function CalendarView({ version }: { version: number }) {
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const today = todayStr();
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const { days, flows, dueItems, monthSummary } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const days: Array<string | null> = [
      ...Array<string | null>(firstWeekday).fill(null),
      ...Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
    ];
    const summary = store.getMonthlySummary(month);
    return {
      days,
      flows: store.getDailyFlows(month),
      dueItems: store.getDueItems(month, today),
      monthSummary: summary,
    };
  }, [month, today, version]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const total = y * 12 + (m - 1) + delta;
    setMonth(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
    setSelectedDay(null);
  };

  const dueByDate = new Map<string, typeof dueItems>();
  for (const item of dueItems) {
    if (!dueByDate.has(item.date)) dueByDate.set(item.date, []);
    dueByDate.get(item.date)!.push(item);
  }

  // 本月总待还（汇总所有 dueItems 金额）+ 是否当前月
  const dueTotal = dueItems.reduce((s, i) => s + i.amount, 0);
  const isCurrentMonth = month === today.slice(0, 7);

  // 点击日期：查询当天流水
  const dayTxs = selectedDay ? store.state.transactions.filter((t) => t.date === selectedDay).sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '')) : [];
  const dayDueItems = selectedDay ? dueItems.filter((i) => i.date === selectedDay) : [];
  const accountName = (id?: string) => (id ? store.getAccount(id)?.name ?? '?' : '');

  // 触摸滑动
  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // 水平滑动距离 > 50 且大于垂直滑动
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      shiftMonth(dx > 0 ? -1 : 1);
    }
  };

  return (
    <div className="panel">
      <div className="calendar-header">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="上月">
          ‹
        </button>
        <h2>{month}</h2>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="下月">
          ›
        </button>
      </div>
      <div className="calendar-grid" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="weekday">
            {w}
          </div>
        ))}
        {days.map((d, i) =>
          d === null ? (
            <div key={`empty-${i}`} className="day empty" />
          ) : (
            <button
              key={d}
              type="button"
              className={`day ${d === today ? 'today' : ''} ${selectedDay === d ? 'selected' : ''} ${flows.get(d) || dueByDate.get(d) ? 'has-data' : ''}`}
              onClick={() => setSelectedDay(d === selectedDay ? null : d)}
            >
              <div className="day-num">{Number(d.slice(-2))}</div>
              {flows.get(d) && (
                <div className="day-flow">
                  {flows.get(d)!.expense > 0 && <span className="negative">-{formatMoney(flows.get(d)!.expense)}</span>}
                  {flows.get(d)!.income > 0 && <span className="positive">+{formatMoney(flows.get(d)!.income)}</span>}
                </div>
              )}
              {dueByDate.get(d) && (
                <div className="day-dots">
                  {dueByDate.get(d)!.map((item, j) => (
                    <span key={j} className={`day-dot ${item.overdue ? 'overdue' : ''}`} />
                  ))}
                </div>
              )}
            </button>
          ),
        )}
      </div>

      {/* 月度汇总：每月总待还；当月额外显示收入与结余 */}
      <div className="calendar-summary">
        <div className="cal-sum-item">
          <span className="cal-sum-label">本月待还</span>
          <span className={`cal-sum-value ${dueTotal > 0 ? 'negative' : ''}`}>
            ¥{formatMoney(dueTotal)}
          </span>
        </div>
        {isCurrentMonth && (
          <>
            <div className="cal-sum-item">
              <span className="cal-sum-label">当月收入</span>
              <span className="cal-sum-value positive">¥{formatMoney(monthSummary.income)}</span>
            </div>
            <div className="cal-sum-item">
              <span className="cal-sum-label">当月结余</span>
              <span className={`cal-sum-value ${monthSummary.income - monthSummary.expense < 0 ? 'negative' : 'positive'}`}>
                ¥{formatMoney(monthSummary.income - monthSummary.expense)}
              </span>
            </div>
          </>
        )}
      </div>

      {selectedDay && (
        <div className="day-detail">
          <div className="day-detail-header">
            <h3>{selectedDay}</h3>
            <button type="button" className="btn-sm" onClick={() => setSelectedDay(null)}>
              ✕
            </button>
          </div>
          {dayDueItems.length > 0 && (
            <ul className="day-due-list">
              {dayDueItems.map((item, i) => (
                <li key={i} className={item.overdue ? 'overdue' : ''}>
                  <span className="due-label">{item.label}</span>
                  <span className="due-amount">¥{formatMoney(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {dayTxs.length > 0 ? (
            <ul className="day-tx-list">
              {dayTxs.map((t: Transaction) => (
                <li key={t.id}>
                  <div className="day-tx-main">
                    <span className="day-tx-desc">{t.description || t.category}</span>
                    <span className="day-tx-meta">
                      {TX_TYPE_LABEL[t.type]} · {accountName(t.accountId)}
                      {t.relatedAccountId ? ` → ${accountName(t.relatedAccountId)}` : ''}
                      {t.time && ` · ${t.time}`}
                    </span>
                  </div>
                  <span className={`tx-amount ${t.type === 'income' || t.type === 'refund' ? 'positive' : 'negative'}`}>
                    {t.type === 'income' || t.type === 'refund' ? '+' : t.type === 'transfer' ? '↔' : '-'}¥{formatMoney(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : dayDueItems.length === 0 ? (
            <p className="empty">当天无流水记录</p>
          ) : null}
        </div>
      )}

      <h3>本月待还</h3>
      <ul className="due-list">
        {dueItems.length === 0 && <li className="empty">本月暂无待还事项</li>}
        {dueItems.map((item, i) => (
          <li key={i} className={item.overdue ? 'overdue' : ''}>
            <span>{item.date}</span>
            <span>{item.label}</span>
            <span>¥{formatMoney(item.amount)}</span>
            {item.overdue && <span className="tag danger">已逾期</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
