import { useRef, useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { store } from './appState';

export function SettingsView({ onChanged }: { onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  const exportData = () => {
    const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `记账数据_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('已导出 JSON 备份');
  };

  const importData = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
        setMessage('文件格式不正确');
        return;
      }
      store.state = parsed;
      store.save();
      onChanged();
      setMessage('导入成功');
    } catch {
      setMessage('导入失败：无法解析文件');
    }
  };

  const clearAll = () => {
    if (window.confirm('确定清空全部数据？此操作不可恢复，建议先导出备份。')) {
      store.clearAll();
      onChanged();
      setMessage('已清空全部数据');
    }
  };

  return (
    <div className="panel">
      <h2>设置</h2>

      <h3>分期计划</h3>
      <ul className="plan-list">
        {store.state.installmentPlans.length === 0 && <li className="empty">暂无分期计划</li>}
        {store.state.installmentPlans.map((p) => (
          <li key={p.id}>
            <span>
              {p.name}（{p.status === 'active' ? '进行中' : p.status === 'completed' ? '已结清' : '已提前结清'}）
            </span>
            <span>
              已还 {p.paidTerms}/{p.term} 期 · 每期 ¥{formatMoney(p.monthlyPayment)}
              {p.status === 'active' && ` · 下期 ${p.nextDueDate}`}
            </span>
          </li>
        ))}
      </ul>

      <h3>周期记账规则</h3>
      <ul className="plan-list">
        {store.state.recurringRules.length === 0 && <li className="empty">暂无周期规则，可在对话中说「每月10号还房贷5000」</li>}
        {store.state.recurringRules.map((r) => (
          <li key={r.id}>
            <span>{r.description}</span>
            <span>
              每月 {r.dayOfMonth} 号 · ¥{formatMoney(r.amount)} · {r.active ? '生效中' : '已停用'}
            </span>
          </li>
        ))}
      </ul>

      <h3>数据管理</h3>
      <div className="settings-actions">
        <button type="button" onClick={exportData}>
          导出 JSON 备份
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          导入备份
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importData(f);
            e.target.value = '';
          }}
        />
        <button type="button" className="danger" onClick={clearAll}>
          清空全部数据
        </button>
      </div>
      {message && <p className="info-text">{message}</p>}
      <p className="meta">数据仅存储在本地浏览器，不会上传。建议定期导出备份。</p>
    </div>
  );
}
