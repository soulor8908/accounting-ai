import { useState } from 'react';
import { isStrongPassword } from '../core/security/crypto';
import {
  disableVault,
  getPlainStateJson,
  hydrateAIConfigJson,
  hydrateChatJson,
  hydrateMemoryJson,
  isVaultEnabled,
  loadVaultMeta,
  lock,
  persistChatJson,
  persistEncryptedState,
  persistMemoryJson,
  resetPasswordByRecoveryCode,
  resetPasswordBySecurityAnswer,
  setupVault,
  unlockWithPassword,
} from '../core/security/vault';
import { STORAGE_KEY as AI_CONFIG_STORAGE_KEY } from '../core/ai/config';
import { CHAT_STORAGE_KEY } from '../core/store/chatStore';
import { MEMORY_STORAGE_KEY } from '../core/store/memory';
import { createEmptyState } from '../core/types';
import { chatStore, memoryStore, store } from './appState';

type Mode = 'unlock' | 'setup' | 'resetAnswer' | 'resetRecovery' | 'disable';

/**
 * 注入加密持久化钩子：store / chatStore / memoryStore 三路同时走 vault。
 * 仅在 vault 已解锁时调用；锁定/关闭时由调用方移除钩子。
 */
function ensureEncryptedPersistHooks(): void {
  if (!store.encryptedPersist) {
    store.encryptedPersist = async (json: string) => {
      try {
        await persistEncryptedState(json);
      } catch (e) {
        console.error('state 加密持久化失败', e);
      }
    };
  }
  if (!chatStore.encryptedPersist) {
    chatStore.encryptedPersist = async (json: string) => {
      try {
        await persistChatJson(json);
      } catch (e) {
        console.error('chat 加密持久化失败', e);
      }
    };
  }
  if (!memoryStore.encryptedPersist) {
    memoryStore.encryptedPersist = async (json: string) => {
      try {
        await persistMemoryJson(json);
      } catch (e) {
        console.error('memory 加密持久化失败', e);
      }
    };
  }
}

/** 移除加密持久化钩子，回退到 localStorage */
function clearEncryptedPersistHooks(): void {
  store.encryptedPersist = undefined;
  chatStore.encryptedPersist = undefined;
  memoryStore.encryptedPersist = undefined;
}

/** 读取当前 localStorage 中的辅助明文（用于 setupVault 迁移） */
function readLegacyAuxData(): { aiConfigJson?: string; chatJson?: string; memoryJson?: string } {
  const aux: { aiConfigJson?: string; chatJson?: string; memoryJson?: string } = {};
  try {
    const ai = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (ai) aux.aiConfigJson = ai;
  } catch { /* ignore */ }
  try {
    const chat = localStorage.getItem(CHAT_STORAGE_KEY);
    if (chat) aux.chatJson = chat;
  } catch { /* ignore */ }
  try {
    const mem = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (mem) aux.memoryJson = mem;
  } catch { /* ignore */ }
  return aux;
}

/** 清除 localStorage 中的辅助明文（迁移到 vault 后调用） */
function clearLegacyAuxData(): void {
  try { localStorage.removeItem(AI_CONFIG_STORAGE_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(MEMORY_STORAGE_KEY); } catch { /* ignore */ }
}

export function LockView({ onUnlocked }: { onUnlocked: () => void }) {
  const [mode, setMode] = useState<Mode>(isVaultEnabled() ? 'unlock' : 'setup');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  // setup
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  // unlock / disable
  const [pwd, setPwd] = useState('');

  // reset
  const [resetAnswerInput, setResetAnswerInput] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPwd, setNewPwd] = useState('');

  const meta = loadVaultMeta();

  /**
   * 解锁完成后的统一收尾：
   * 1. 注入三路加密持久化钩子
   * 2. 加载 state 到 store
   * 3. hydrate AI 配置 / 聊天 / 记忆 到各自 store 的内存（同时填充 vault 缓存）
   * 4. 通知上层渲染主界面
   */
  const finishUnlock = async () => {
    ensureEncryptedPersistHooks();
    const json = getPlainStateJson();
    if (json) store.loadFromJson(json);
    // hydrate 辅助数据：失败则保持空内存（不阻塞解锁）
    const [aiJson, chatJson, memJson] = await Promise.all([
      hydrateAIConfigJson(),
      hydrateChatJson(),
      hydrateMemoryJson(),
    ]);
    if (chatJson) chatStore.loadFromJson(chatJson);
    if (memJson) memoryStore.loadFromJson(memJson);
    // AI 配置通过 getCachedAIConfigJson 被 config.loadAIConfig 同步读取，无需额外注入
    void aiJson;
    onUnlocked();
  };

  const handleSetup = async () => {
    setMessage('');
    if (!isStrongPassword(pwd1)) {
      setMessage('密码至少 8 位，需含字母和数字');
      return;
    }
    if (pwd1 !== pwd2) {
      setMessage('两次密码不一致');
      return;
    }
    if (!question.trim() || !answer.trim()) {
      setMessage('请填写安全问题和答案');
      return;
    }
    setBusy(true);
    const stateJson = store.serialize();
    // 启用加密时把 localStorage 中的辅助明文一并迁移进 vault，原子加密
    const aux = readLegacyAuxData();
    const r = await setupVault(
      { password: pwd1, securityQuestion: question.trim(), securityAnswer: answer.trim() },
      stateJson,
      aux,
    );
    setBusy(false);
    if (r.ok && r.recoveryCode) {
      setRecoveryCode(r.recoveryCode);
      setMessage('加密已启用');
      ensureEncryptedPersistHooks();
      // 迁移成功后清除 localStorage 中的明文辅助数据
      clearLegacyAuxData();
    } else {
      setMessage(r.error ?? '设置失败');
    }
  };

  const handleUnlock = async () => {
    setMessage('');
    setBusy(true);
    const r = await unlockWithPassword(pwd);
    setBusy(false);
    if (r.ok) {
      await finishUnlock();
    } else {
      setMessage(r.error ?? '解锁失败');
      setPwd('');
    }
  };

  const handleResetByAnswer = async () => {
    setMessage('');
    setBusy(true);
    const r = await resetPasswordBySecurityAnswer(resetAnswerInput, newPwd);
    setBusy(false);
    if (r.ok) await finishUnlock();
    else setMessage(r.error ?? '重置失败');
  };

  const handleResetByRecovery = async () => {
    setMessage('');
    setBusy(true);
    const r = await resetPasswordByRecoveryCode(recoveryInput, newPwd);
    setBusy(false);
    if (r.ok) await finishUnlock();
    else setMessage(r.error ?? '重置失败');
  };

  const handleDisable = async () => {
    setMessage('');
    setBusy(true);
    const r = await disableVault(pwd);
    setBusy(false);
    if (r.ok) {
      clearEncryptedPersistHooks();
      store.loadFromJson(r.stateJson!);
      store.save();
      // 把 vault 中解密出的辅助数据写回 localStorage（明文，回退到旧版行为）
      if (r.aiConfigJson) {
        try { localStorage.setItem(AI_CONFIG_STORAGE_KEY, r.aiConfigJson); } catch { /* ignore */ }
      }
      if (r.chatJson) {
        try { localStorage.setItem(CHAT_STORAGE_KEY, r.chatJson); } catch { /* ignore */ }
        chatStore.loadFromJson(r.chatJson);
      }
      if (r.memoryJson) {
        try { localStorage.setItem(MEMORY_STORAGE_KEY, r.memoryJson); } catch { /* ignore */ }
        memoryStore.loadFromJson(r.memoryJson);
      }
      onUnlocked();
    } else {
      setMessage(r.error ?? '关闭失败');
    }
  };

  const handleLock = () => {
    lock();
    clearEncryptedPersistHooks();
    // 清空内存中的 store state（含聊天/记忆/AI 配置缓存）
    // 使用工厂函数避免硬编码 schemaVersion，确保与 types.ts 的 SCHEMA_VERSION 对齐
    store.state = createEmptyState();
    chatStore.clearInMemoryData();
    memoryStore.clearInMemoryData();
    setPwd('');
    setMode('unlock');
    setMessage('已锁定');
  };

  return (
    <div className="lock-view panel">
      <h2>{mode === 'setup' ? '启用加密' : mode === 'unlock' ? '解锁' : mode === 'disable' ? '关闭加密' : '重置密码'}</h2>

      {mode === 'setup' && !recoveryCode && (
        <div className="lock-form">
          <p className="meta">启用加密后，每次进入都需要密码。数据用 AES-GCM 256 加密存储在本地。</p>
          <label className="form-row">
            <span>密码（≥8 位，字母+数字）</span>
            <input type="password" value={pwd1} onChange={(e) => setPwd1(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="form-row">
            <span>确认密码</span>
            <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="form-row">
            <span>安全问题（用于重置密码）</span>
            <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="如：你的小学叫什么名字？" />
          </label>
          <label className="form-row">
            <span>安全问题答案</span>
            <input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={handleSetup} disabled={busy}>{busy ? '处理中…' : '启用加密'}</button>
          </div>
          {message && <p className="error-text">{message}</p>}
        </div>
      )}

      {mode === 'setup' && recoveryCode && (
        <div className="lock-form">
          <p className="info-text">加密已启用！请妥善保存以下恢复码（仅显示一次）：</p>
          <div className="recovery-code-box">{recoveryCode}</div>
          <p className="meta">恢复码用于忘记密码时重置；安全问题答案也可用于重置。两者均可解开数据。</p>
          <div className="settings-actions">
            <button type="button" onClick={() => { setRecoveryCode(''); onUnlocked(); }}>我已保存，进入</button>
          </div>
        </div>
      )}

      {mode === 'unlock' && (
        <div className="lock-form">
          <p className="meta">输入密码解锁数据</p>
          <label className="form-row">
            <span>密码</span>
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && handleUnlock()}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={handleUnlock} disabled={busy}>{busy ? '解锁中…' : '解锁'}</button>
            <button type="button" className="btn-sm" onClick={() => { setMode('resetAnswer'); setMessage(''); }}>
              忘记密码
            </button>
          </div>
          {message && <p className="error-text">{message}</p>}
        </div>
      )}

      {mode === 'resetAnswer' && (
        <div className="lock-form">
          <p className="meta">用安全问题答案重置密码</p>
          {meta?.securityQuestion && (
            <p className="info-text">问题：{meta.securityQuestion}</p>
          )}
          <label className="form-row">
            <span>答案</span>
            <input type="text" value={resetAnswerInput} onChange={(e) => setResetAnswerInput(e.target.value)} autoComplete="off" />
          </label>
          <label className="form-row">
            <span>新密码（≥8 位，字母+数字）</span>
            <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={handleResetByAnswer} disabled={busy}>重置</button>
            <button type="button" className="btn-sm" onClick={() => { setMode('resetRecovery'); setMessage(''); }}>
              用恢复码
            </button>
            <button type="button" className="btn-sm" onClick={() => { setMode('unlock'); setMessage(''); }}>
              返回
            </button>
          </div>
          {message && <p className="error-text">{message}</p>}
        </div>
      )}

      {mode === 'resetRecovery' && (
        <div className="lock-form">
          <p className="meta">用恢复码重置密码（恢复码使用后失效）</p>
          <label className="form-row">
            <span>恢复码</span>
            <input type="text" value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
          </label>
          <label className="form-row">
            <span>新密码（≥8 位，字母+数字）</span>
            <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={handleResetByRecovery} disabled={busy}>重置</button>
            <button type="button" className="btn-sm" onClick={() => { setMode('resetAnswer'); setMessage(''); }}>
              用安全问题
            </button>
            <button type="button" className="btn-sm" onClick={() => { setMode('unlock'); setMessage(''); }}>
              返回
            </button>
          </div>
          {message && <p className="error-text">{message}</p>}
        </div>
      )}

      {mode === 'disable' && (
        <div className="lock-form">
          <p className="meta">关闭加密会将数据恢复为明文存储</p>
          <label className="form-row">
            <span>当前密码</span>
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={handleDisable} disabled={busy}>关闭加密</button>
            <button type="button" className="btn-sm" onClick={handleLock}>锁定</button>
          </div>
          {message && <p className="error-text">{message}</p>}
        </div>
      )}
    </div>
  );
}
