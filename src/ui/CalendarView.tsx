import { useMemo, useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { store } from './appState';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function CalendarView({ version }: { version: number }) {
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const today = todayStr();

  const { days, flows, dueItems } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    // 周一开头：1号前面补的空格数
    const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const days: Array<string | null> = [
      ...Array<string | null>(firstWeekday).fill(null),
      ...Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
    ];
    return { days, flows: store.getDailyFlows(month), dueItems: store.getDueItems(month, today) };
    // version 驱动 store 变更后的重算
  }, [month, today, version]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const total = y * 12 + (m - 1) + delta;
    setMonth(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  };

  const dueByDate = new Map<string, typeof dueItems>();
  for (const item of dueItems) {
    if (!dueByDate.has(item.date)) dueByDate.set(item.date, []);
    dueByDate.get(item.date)!.push(item);
  }

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
      <div className="calendar-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="weekday">
            {w}
          </div>
        ))}
        {days.map((d, i) =>
          d === null ? (
            <div key={`empty-${i}`} className="day empty" />
          ) : (
            <div key={d} className={`day ${d === today ? 'today' : ''}`}>
              <div className="day-num">{Number(d.slice(-2))}</div>
              {flows.get(d) && (
                <div className="day-flow">
                  {flows.get(d)!.expense > 0 && <span className="negative">-{formatMoney(flows.get(d)!.expense)}</span>}
                  {flows.get(d)!.income > 0 && <span className="positive">+{formatMoney(flows.get(d)!.income)}</span>}
                </div>
              )}
              {dueByDate.get(d)?.map((item, j) => (
                <div key={j} className={`due-item ${item.overdue ? 'overdue' : ''}`} title={item.label}>
                  {item.label} ¥{formatMoney(item.amount)}
                </div>
              ))}
            </div>
          ),
        )}
      </div>
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
