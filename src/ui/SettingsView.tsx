import { type FormEvent, useRef, useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { AI_PROVIDERS, type AIConfig, clearAIConfig, defaultConfig, loadAIConfig, saveAIConfig } from '../core/ai/config';
import { testAIConfig } from '../core/ai/client';
import { isValidStateShape } from '../core/store/store';
import { isVaultEnabled, lock } from '../core/security/vault';
import { store } from './appState';
import { resetChatHistory } from './ChatView';

export function SettingsView({ onChanged, onLock }: { onChanged: () => void; onLock?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  // AI 配置
  const existing = loadAIConfig() ?? defaultConfig();
  const [aiConfig, setAIConfig] = useState<AIConfig>(existing);
  const [aiMessage, setAIMessage] = useState('');
  const [aiMessageKind, setAIMessageKind] = useState<'info' | 'error' | 'success'>('info');
  const [testing, setTesting] = useState(false);

  const onProviderChange = (providerId: string) => {
    const preset = AI_PROVIDERS.find((p) => p.id === providerId);
    if (preset) {
      setAIConfig({
        ...aiConfig,
        providerId,
        baseUrl: preset.baseUrl || aiConfig.baseUrl,
        model: preset.defaultModel || aiConfig.model,
      });
    }
  };

  const onAISubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!aiConfig.apiKey.trim()) {
      setAIMessageKind('error');
      setAIMessage('请填写 API Key');
      return;
    }
    saveAIConfig(aiConfig);
    setAIMessageKind('success');
    setAIMessage('AI 配置已保存');
    resetChatHistory();
    onChanged();
  };

  /** 测试 AI 配置：发送一个轻量请求验证连通性与鉴权 */
  const onTestAI = async () => {
    if (!aiConfig.apiKey.trim()) {
      setAIMessageKind('error');
      setAIMessage('请先填写 API Key 再测试');
      return;
    }
    setTesting(true);
    setAIMessageKind('info');
    setAIMessage('正在测试连接...');
    try {
      // 用当前表单中的配置即时测试（不要求先保存）
      const result = await testAIConfig(aiConfig);
      setAIMessageKind(result.ok ? 'success' : 'error');
      setAIMessage(result.message);
    } finally {
      setTesting(false);
    }
  };

  const onClearAI = () => {
    if (!window.confirm('确定清除 AI 配置？清除后将回退到本地解析引擎，已保存的 API Key 将被删除。')) return;
    clearAIConfig();
    setAIConfig(defaultConfig());
    setAIMessageKind('info');
    setAIMessage('AI 配置已清除，将使用本地解析引擎');
    onChanged();
  };

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
      const parsed: unknown = JSON.parse(await file.text());
      if (!isValidStateShape(parsed)) {
        setMessage('文件格式不正确或版本不兼容');
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
      resetChatHistory();
      onChanged();
      setMessage('已清空全部数据');
    }
  };

  const currentPreset = AI_PROVIDERS.find((p) => p.id === aiConfig.providerId);

  return (
    <div className="panel">
      <h2>设置</h2>

      <h3>AI 助手配置</h3>
      <form className="ai-config-form" onSubmit={onAISubmit}>
        <label className="form-row">
          <span>AI 服务商</span>
          <select value={aiConfig.providerId} onChange={(e) => onProviderChange(e.target.value)}>
            {AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span>API Key</span>
          <input
            type="password"
            value={aiConfig.apiKey}
            onChange={(e) => setAIConfig({ ...aiConfig, apiKey: e.target.value })}
            placeholder="sk-..."
            autoComplete="off"
          />
        </label>
        <label className="form-row">
          <span>Base URL</span>
          <input
            type="text"
            value={aiConfig.baseUrl}
            onChange={(e) => setAIConfig({ ...aiConfig, baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com"
          />
        </label>
        <label className="form-row">
          <span>模型</span>
          {currentPreset && currentPreset.models.length > 0 ? (
            <select value={aiConfig.model} onChange={(e) => setAIConfig({ ...aiConfig, model: e.target.value })}>
              {currentPreset.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {aiConfig.providerId === 'custom' && <option value={aiConfig.model}>{aiConfig.model}</option>}
            </select>
          ) : (
            <input
              type="text"
              value={aiConfig.model}
              onChange={(e) => setAIConfig({ ...aiConfig, model: e.target.value })}
              placeholder="模型名称"
            />
          )}
        </label>
        <div className="settings-actions">
          <button type="submit">保存 AI 配置</button>
          <button type="button" onClick={onTestAI} disabled={testing}>
            {testing ? '测试中...' : '测试连接'}
          </button>
          <button type="button" onClick={onClearAI}>
            清除配置
          </button>
        </div>
        {aiMessage && (
          <p className={aiMessageKind === 'error' ? 'error-text' : aiMessageKind === 'success' ? 'success-text' : 'info-text'}>
            {aiMessage}
          </p>
        )}
        <p className="meta">
          配置后可在「对话」页用自然语言记账、查询、编辑。点击「测试连接」验证 API Key、Base URL、模型是否可用。API Key 仅存储在本地浏览器。
          {aiConfig.providerId === 'deepseek' && ' DeepSeek 默认使用 deepseek-v4-flash。'}
        </p>
      </form>

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

      {isVaultEnabled() && (
        <>
          <h3>加密保险库</h3>
          <div className="settings-actions">
            <button
              type="button"
              onClick={() => {
                lock();
                store.encryptedPersist = undefined;
                onLock?.();
              }}
            >
              立即锁定
            </button>
          </div>
          <p className="meta">锁定后需要重新输入密码才能查看数据。关闭加密请通过「忘记密码」流程操作。</p>
        </>
      )}
    </div>
  );
}
