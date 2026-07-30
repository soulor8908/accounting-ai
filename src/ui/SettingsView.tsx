import { type FormEvent, useRef, useState } from 'react';
import { formatMoney } from '../core/engine/engine';
import { AI_PROVIDERS, type AIConfig, clearAIConfig, defaultConfig, loadAIConfig, saveAIConfig } from '../core/ai/config';
import { testAIConfig } from '../core/ai/client';
import { isValidStateShape } from '../core/store/store';
import type { MemoryCategory } from '../core/store/memory';
import { isStrongPassword } from '../core/security/crypto';
import { createBackup, restoreBackup } from '../core/security/backup';
import { isVaultEnabled, lock } from '../core/security/vault';
import { chatStore, memoryStore, store } from './appState';
import { resetChatHistory } from './ChatView';
import { dialog } from './Dialog';
import {
  type Agent,
  addAgent,
  listAllAgents,
  removeAgent,
  toggleBuiltinAgent,
  updateAgent,
} from '../core/ai/agents';

const MEMORY_CATEGORY_OPTIONS: Array<{ value: MemoryCategory; label: string }> = [
  { value: 'fact', label: '事实' },
  { value: 'habit', label: '习惯' },
  { value: 'preference', label: '偏好' },
];

const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = {
  fact: '事实',
  habit: '习惯',
  preference: '偏好',
};

export function SettingsView({ onChanged, onLock }: { onChanged: () => void; onLock?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const encFileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  // AI 配置
  const existing = loadAIConfig() ?? defaultConfig();
  const [aiConfig, setAIConfig] = useState<AIConfig>(existing);
  const [aiMessage, setAIMessage] = useState('');
  const [aiMessageKind, setAIMessageKind] = useState<'info' | 'error' | 'success'>('info');
  const [testing, setTesting] = useState(false);

  // 记忆管理
  const [memVersion, setMemVersion] = useState(0);
  const bumpMem = () => setMemVersion((v) => v + 1);
  const [newMemContent, setNewMemContent] = useState('');
  const [newMemCategory, setNewMemCategory] = useState<MemoryCategory>('fact');
  const [editingMemId, setEditingMemId] = useState<string | null>(null);
  const [editMemContent, setEditMemContent] = useState('');
  const [editMemCategory, setEditMemCategory] = useState<MemoryCategory>('fact');
  // 每次渲染读取最新记忆（memVersion 仅用于触发重渲染）
  void memVersion;
  const memories = memoryStore.list();

  // Agent 管理
  const [agentVersion, setAgentVersion] = useState(0);
  const bumpAgent = () => setAgentVersion((v) => v + 1);
  void agentVersion;
  const allAgents = listAllAgents();
  const enabledAgentCount = allAgents.filter((a) => !a.disabled).length;

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

  const onAISubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!aiConfig.apiKey.trim()) {
      setAIMessageKind('error');
      setAIMessage('请填写 API Key');
      return;
    }
    setAIMessageKind('info');
    setAIMessage('正在保存...');
    try {
      await saveAIConfig(aiConfig);
      setAIMessageKind('success');
      setAIMessage('AI 配置已保存');
      resetChatHistory();
      onChanged();
    } catch (err) {
      setAIMessageKind('error');
      setAIMessage(err instanceof Error ? err.message : '保存失败');
    }
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

  const onClearAI = async () => {
    const ok = await dialog.confirm(
      '确定清除 AI 配置？清除后将回退到本地解析引擎，已保存的 API Key 将被删除。',
      '清除 AI 配置',
    );
    if (!ok) return;
    try {
      await clearAIConfig();
      setAIConfig(defaultConfig());
      setAIMessageKind('info');
      setAIMessage('AI 配置已清除，将使用本地解析引擎');
      onChanged();
      dialog.toast('AI 配置已清除', 'success');
    } catch (err) {
      setAIMessageKind('error');
      setAIMessage(err instanceof Error ? err.message : '清除失败');
      dialog.toast('清除失败', 'error');
    }
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

  /** 导出全量加密备份（账本+聊天+记忆+AI 配置），需设置口令 */
  const exportEncrypted = async () => {
    const pw = await dialog.prompt(
      '设置备份口令（用于加密，恢复时需要）',
      '',
      '至少8位，含字母和数字',
      '导出加密备份',
    );
    if (!pw) return;
    if (!isStrongPassword(pw)) {
      setMessage('口令过弱：至少8位且含字母和数字');
      return;
    }
    try {
      const json = await createBackup(pw);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `记账备份_${new Date().toISOString().slice(0, 10)}.abak`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('已导出加密备份（.abak）');
      dialog.toast('已导出加密备份', 'success');
    } catch {
      setMessage('导出失败');
    }
  };

  /** 导入加密备份：选文件 → 输入口令 → 还原 */
  const importEncrypted = async (file: File) => {
    const text = await file.text();
    const pw = await dialog.prompt('输入备份口令', '', '导出时设置的口令', '导入加密备份');
    if (!pw) return;
    const ok = await restoreBackup(text, pw);
    if (ok) {
      onChanged();
      setMessage('加密备份已还原');
      dialog.toast('加密备份已还原', 'success');
    } else {
      setMessage('还原失败：口令错误或文件已损坏');
      dialog.toast('还原失败', 'error');
    }
  };

  const clearAll = async () => {
    const ok = await dialog.confirm(
      '确定清空全部数据？此操作不可恢复，建议先导出备份。',
      '清空全部数据',
    );
    if (!ok) return;
    store.clearAll();
    memoryStore.clearAll();
    chatStore.clearAll();
    resetChatHistory();
    onChanged();
    setMessage('已清空全部数据');
    dialog.toast('已清空全部数据', 'success');
  };

  // ---------- 记忆管理 ----------
  const addMemory = (e: FormEvent) => {
    e.preventDefault();
    const content = newMemContent.trim();
    if (!content) return;
    memoryStore.add({ content, category: newMemCategory, source: 'manual' });
    setNewMemContent('');
    bumpMem();
    onChanged();
  };

  const startEditMemory = (id: string, content: string, category: MemoryCategory) => {
    setEditingMemId(id);
    setEditMemContent(content);
    setEditMemCategory(category);
  };

  const saveEditMemory = () => {
    if (!editingMemId) return;
    const content = editMemContent.trim();
    if (!content) return;
    memoryStore.update(editingMemId, { content, category: editMemCategory });
    setEditingMemId(null);
    setEditMemContent('');
    bumpMem();
    onChanged();
  };

  const cancelEditMemory = () => {
    setEditingMemId(null);
    setEditMemContent('');
  };

  const deleteMemory = async (id: string, content: string) => {
    const ok = await dialog.confirm(`确定删除记忆「${content}」？`, '删除记忆');
    if (!ok) return;
    memoryStore.remove(id);
    bumpMem();
    onChanged();
    dialog.toast('记忆已删除', 'success');
  };

  const clearAllMemories = async () => {
    if (memories.length === 0) return;
    const ok = await dialog.confirm(
      `确定清空全部 ${memories.length} 条记忆？此操作不可恢复。`,
      '清空全部记忆',
    );
    if (!ok) return;
    memoryStore.clearAll();
    bumpMem();
    onChanged();
    setMessage('已清空全部记忆');
    dialog.toast('已清空全部记忆', 'success');
  };

  const clearAllChats = async () => {
    const sessions = chatStore.list();
    if (sessions.length === 0) return;
    const ok = await dialog.confirm(
      `确定清空全部 ${sessions.length} 个聊天会话？此操作不可恢复。`,
      '清空全部会话',
    );
    if (!ok) return;
    chatStore.clearAll();
    resetChatHistory();
    onChanged();
    setMessage('已清空全部聊天记录');
    dialog.toast('已清空全部聊天记录', 'success');
  };

  // ---------- Agent 管理 ----------
  const onCreateAgent = async () => {
    const name = await dialog.prompt('输入 Agent 名称', '', '如：记账助手', '新建 Agent');
    if (!name?.trim()) return;
    const description = await dialog.prompt('一句话描述这个 Agent 的用途', '', '如：快速记账', 'Agent 描述');
    if (description === null) return;
    const systemPrompt = await dialog.prompt(
      '输入系统提示词（定义 Agent 的人设与工作方式）',
      '你是一个智能助手。',
      '系统提示词',
      '系统提示词',
    );
    if (systemPrompt === null || !systemPrompt.trim()) return;
    addAgent({ name: name.trim(), description: description.trim() || '自定义 Agent', systemPrompt: systemPrompt.trim() });
    bumpAgent();
    dialog.toast('Agent 已创建', 'success');
  };

  const onEditAgent = async (a: Agent) => {
    const name = await dialog.prompt('Agent 名称', a.name, '', '编辑 Agent');
    if (name === null) return;
    const description = await dialog.prompt('Agent 描述', a.description, '', '编辑 Agent');
    if (description === null) return;
    const systemPrompt = await dialog.prompt('系统提示词', a.systemPrompt, '', '编辑 Agent');
    if (systemPrompt === null) return;
    if (!updateAgent(a.id, { name: name.trim() || a.name, description: description.trim(), systemPrompt: systemPrompt.trim() })) {
      dialog.toast('预置 Agent 不可编辑', 'error');
      return;
    }
    bumpAgent();
    dialog.toast('已更新', 'success');
  };

  const onDeleteAgent = async (a: Agent) => {
    const ok = await dialog.confirm(`确定删除 Agent「${a.name}」？`, '删除 Agent');
    if (!ok) return;
    if (!removeAgent(a.id)) {
      dialog.toast('预置 Agent 不可删除', 'error');
      return;
    }
    bumpAgent();
    dialog.toast('已删除', 'success');
  };

  const onToggleBuiltin = (a: Agent, enable: boolean) => {
    toggleBuiltinAgent(a.id, enable);
    bumpAgent();
    dialog.toast(enable ? '已启用' : '已禁用', 'success');
  };

  const currentPreset = AI_PROVIDERS.find((p) => p.id === aiConfig.providerId);

  return (
    <div className="panel">
      <h2>设置</h2>

      <h3 id="ai-config-section">AI 助手配置</h3>
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
        {!isVaultEnabled() && (
          <p className="error-text">⚠️ 当前未启用加密保险库，API Key 以明文存储在浏览器 localStorage 中，同设备其他脚本可能读取。建议启用加密保险库以加密存储密钥。</p>
        )}
      </form>

      <h3>Agent 人设（{enabledAgentCount} 个可用）</h3>
      <p className="meta">在「对话」页可一键切换不同 Agent。预置 Agent 不可删除但可禁用，也可创建自定义 Agent。</p>
      <ul className="agent-settings-list">
        {allAgents.map((a) => (
          <li key={a.id} className={`agent-settings-item${a.disabled ? ' disabled' : ''}`}>
            <div className="agent-settings-main">
              <div className="agent-settings-name">
                {a.name}
                {a.builtin && <span className="tag">预置</span>}
                {a.disabled && <span className="tag muted">已禁用</span>}
              </div>
              <div className="agent-settings-desc">{a.description}</div>
            </div>
            <div className="agent-settings-actions">
              {a.builtin ? (
                a.disabled ? (
                  <button type="button" className="btn-sm" onClick={() => onToggleBuiltin(a, true)}>启用</button>
                ) : (
                  <button type="button" className="btn-sm" onClick={() => onToggleBuiltin(a, false)}>禁用</button>
                )
              ) : (
                <>
                  <button type="button" className="btn-sm" onClick={() => void onEditAgent(a)}>编辑</button>
                  <button type="button" className="btn-sm danger" onClick={() => void onDeleteAgent(a)}>删除</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="settings-actions">
        <button type="button" onClick={() => void onCreateAgent()}>+ 新建 Agent</button>
      </div>

      <h3>AI 记忆（{memories.length} 条）</h3>
      <p className="meta">AI 会记住你的长期偏好、事实和行为习惯，并在对话中运用。也可在对话里直接说「你记得我什么」「记住我喜欢…」「忘掉那条」来管理。</p>
      <form className="memory-form" onSubmit={addMemory}>
        <input
          type="text"
          value={newMemContent}
          onChange={(e) => setNewMemContent(e.target.value)}
          placeholder="添加一条记忆，如「偏好用微信零钱支付」"
          aria-label="记忆内容"
          maxLength={200}
        />
        <select
          value={newMemCategory}
          onChange={(e) => setNewMemCategory(e.target.value as MemoryCategory)}
          aria-label="记忆类型"
        >
          {MEMORY_CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" disabled={!newMemContent.trim()}>添加</button>
      </form>
      <ul className="memory-list">
        {memories.length === 0 && <li className="empty">暂无记忆，可在上方添加或在对话中让 AI 自动记录</li>}
        {memories.map((m) => (
          <li key={m.id} className="memory-item">
            {editingMemId === m.id ? (
              <div className="memory-edit-form">
                <input
                  type="text"
                  value={editMemContent}
                  onChange={(e) => setEditMemContent(e.target.value)}
                  aria-label="编辑记忆内容"
                  maxLength={200}
                  autoFocus
                />
                <select
                  value={editMemCategory}
                  onChange={(e) => setEditMemCategory(e.target.value as MemoryCategory)}
                  aria-label="编辑记忆类型"
                >
                  {MEMORY_CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <div className="edit-actions">
                  <button type="button" className="btn-primary-sm" onClick={saveEditMemory}>保存</button>
                  <button type="button" className="btn-sm" onClick={cancelEditMemory}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="memory-main">
                  <span className={`memory-tag cat-${m.category}`}>{MEMORY_CATEGORY_LABEL[m.category]}</span>
                  {m.source === 'auto' && <span className="memory-tag auto">自动</span>}
                  <span className="memory-content">{m.content}</span>
                </div>
                <div className="memory-actions">
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => startEditMemory(m.id, m.content, m.category)}
                  >编辑</button>
                  <button
                    type="button"
                    className="btn-sm danger"
                    onClick={() => deleteMemory(m.id, m.content)}
                  >删除</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {memories.length > 0 && (
        <div className="settings-actions">
          <button type="button" className="danger" onClick={clearAllMemories}>清空全部记忆</button>
        </div>
      )}

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
        <button type="button" onClick={exportEncrypted}>
          导出加密备份
        </button>
        <button type="button" onClick={() => encFileRef.current?.click()}>
          导入加密备份
        </button>
        <input
          ref={encFileRef}
          type="file"
          accept=".abak,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importEncrypted(f);
            e.target.value = '';
          }}
        />
        <button type="button" className="danger" onClick={clearAllChats}>
          清空聊天记录
        </button>
        <button type="button" className="danger" onClick={clearAll}>
          清空全部数据
        </button>
      </div>
      <p className="meta">「导出加密备份」会把账本、聊天、记忆与 AI 配置一起加密成一个 .abak 文件，可跨设备恢复，解决纯本地存储清缓存即丢数据的问题。</p>
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
