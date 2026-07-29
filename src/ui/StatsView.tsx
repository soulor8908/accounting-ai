import { useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { store } from './appState';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function StatsView() {
  const [month, setMonth] = useState(currentMonth());
  const summary = store.getMonthlySummary(month);
  const cats = store.getCategoryStats(month);
  const maxCat = cats[0]?.amount ?? 0;

  return (
    <div className="panel">
      <h2>统计</h2>
      <div className="filter-row">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="统计月份" />
      </div>
      <div className="stat-cards">
        <div className="stat-card">
          <span className="overview-label">支出</span>
          <span className="overview-value negative">¥{formatMoney(summary.expense)}</span>
        </div>
        <div className="stat-card">
          <span className="overview-label">收入</span>
          <span className="overview-value positive">¥{formatMoney(summary.income)}</span>
        </div>
        <div className="stat-card">
          <span className="overview-label">结余</span>
          <span className="overview-value">¥{formatMoney(summary.income - summary.expense)}</span>
        </div>
        <div className="stat-card">
          <span className="overview-label">笔数</span>
          <span className="overview-value">{summary.count}</span>
        </div>
      </div>
      <h3>分类支出</h3>
      {cats.length === 0 && <p className="empty">本月暂无支出</p>}
      <ul className="cat-list">
        {cats.map((c) => (
          <li key={c.category}>
            <span className="cat-name">{c.category}</span>
            <div className="cat-bar-wrap">
              <div className="cat-bar" style={{ width: `${maxCat > 0 ? (c.amount / maxCat) * 100 : 0}%` }} />
            </div>
            <span className="cat-amount">¥{formatMoney(c.amount)}</span>
          </li>
        ))}
      </ul>
      <h3>资产负债</h3>
      <ul className="balance-list">
        <li>
          <span className="balance-label">总资产</span>
          <span className="balance-value">¥{formatMoney(store.getTotalAssets())}</span>
        </li>
        <li>
          <span className="balance-label">总负债</span>
          <span className="balance-value negative">¥{formatMoney(store.getTotalLiabilities())}</span>
        </li>
        <li>
          <span className="balance-label">净资产</span>
          <span className="balance-value positive">
            ¥{formatMoney(store.getTotalAssets() - store.getTotalLiabilities())}
          </span>
        </li>
      </ul>
    </div>
  );
}
