import { useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { analyzeTrends, prevMonth } from '../core/analytics/trends';
import { round2 } from '../core/utils/money';
import { store } from './appState';
import { TrendChart } from './TrendChart';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function pctLabel(p: number | null): string {
  if (p === null) return '—';
  return `${p > 0 ? '+' : ''}${p}%`;
}

export function StatsView() {
  const [month, setMonth] = useState(currentMonth());
  const summary = store.getMonthlySummary(month);
  const cats = store.getCategoryStats(month);
  const maxCat = cats[0]?.amount ?? 0;
  const trend = analyzeTrends(store.state.transactions, { referenceMonth: month });

  // 逐日累计支出序列（本月 / 上月），供走势图使用
  const buildCumulative = (m: string): { day: number; value: number }[] => {
    const flows = store.getDailyFlows(m);
    const [y, mo] = m.split('-').map(Number);
    const dim = new Date(y, mo, 0).getDate();
    let cum = 0;
    const out: { day: number; value: number }[] = [];
    for (let d = 1; d <= dim; d++) {
      const key = `${m}-${String(d).padStart(2, '0')}`;
      cum = round2(cum + (flows.get(key)?.expense ?? 0));
      out.push({ day: d, value: cum });
    }
    return out;
  };
  const curSeries = buildCumulative(month);
  const prevSeries = buildCumulative(prevMonth(month));
  const prevTotal = prevSeries.length > 0 ? prevSeries[prevSeries.length - 1].value : 0;

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
      <h3>环比 / 同比</h3>
      <div className="stat-cards">
        <div className="stat-card">
          <span className="overview-label">支出环比</span>
          <span className={`overview-value ${trend.expense.pct !== null && trend.expense.pct > 0 ? 'negative' : 'positive'}`}>{pctLabel(trend.expense.pct)}</span>
        </div>
        <div className="stat-card">
          <span className="overview-label">支出同比</span>
          <span className={`overview-value ${trend.expense.yoyPct !== null && trend.expense.yoyPct > 0 ? 'negative' : 'positive'}`}>{pctLabel(trend.expense.yoyPct)}</span>
        </div>
        <div className="stat-card">
          <span className="overview-label">收入环比</span>
          <span className="overview-value positive">{pctLabel(trend.income.pct)}</span>
        </div>
        <div className="stat-card">
          <span className="overview-label">预计全月</span>
          <span className="overview-value">¥{formatMoney(trend.projectedMonthExpense)}</span>
        </div>
      </div>
      <h3>支出走势</h3>
      <TrendChart current={curSeries} previous={prevSeries} prevTotal={prevTotal} projected={trend.projectedMonthExpense} />
      {(trend.topRisers.length > 0 || trend.topFallers.length > 0) && (
        <>
          <h3>分类涨跌（对比上月）</h3>
          <ul className="cat-list">
            {trend.topRisers.map((c) => (
              <li key={`r-${c.category}`}>
                <span className="cat-name">↑ {c.category}</span>
                <span className="cat-amount">¥{formatMoney(c.current)}（{pctLabel(c.pct)}）</span>
              </li>
            ))}
            {trend.topFallers.map((c) => (
              <li key={`f-${c.category}`}>
                <span className="cat-name">↓ {c.category}</span>
                <span className="cat-amount">¥{formatMoney(c.current)}（{pctLabel(c.pct)}）</span>
              </li>
            ))}
          </ul>
        </>
      )}
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
