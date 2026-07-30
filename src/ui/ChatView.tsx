import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type EngineResult, formatMoney } from '../core/engine/engine';
import { getEffectiveConfig, isTrialAvailable, isUsingBuiltinConfig } from '../core/ai/config';
import { DAILY_TRIAL_LIMIT, getTrialRemaining, hasTrialQuota, recordTrialUsage } from '../core/ai/trialQuota';
import type { ChatMessage as AIMessage } from '../core/ai/client';
import { extractHabit } from '../core/ai/habits';
import type { Account, Transaction } from '../core/types';
import {
  AMOUNT_PLACEHOLDER,
  findPlaceholderRange,
  hasAmountPlaceholder,
} from '../core/store/quickInput';
import { chatStore, engine, memoryStore, quickInputStore, store } from './appState';
import type { ChatMessageRecord } from '../core/store/chatStore';
import { dialog } from './Dialog';
import { FullscreenModal } from './FullscreenModal';
import { Icon } from './Icon';
import { type Agent, getActiveAgent, listAgents, setActiveAgent } from '../core/ai/agents';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  status?: EngineResult['status'] | 'thinking' | 'tool' | 'ai';
  options?: string[];
  /** 流式输出中 */
  streaming?: boolean;
}

const INITIAL_MESSAGE: ChatMessage = { role: 'ai', text: '你好，我是记账助手。直接说「吃午饭25」就能记账，也可以问我「这个月花了多少」。' };

/** UI 消息 → 持久化记录（剥离 streaming，归一化瞬态 status） */
function toRecord(m: ChatMessage): Omit<ChatMessageRecord, 'id' | 'createdAt'> {
  const persistableStatus =
    m.status === 'ok' || m.status === 'error' || m.status === 'confirm' ? m.status : undefined;
  return { role: m.role, text: m.text, status: persistableStatus, options: m.options };
}

/** 持久化记录 → UI 消息 */
function fromRecord(r: ChatMessageRecord): ChatMessage {
  return { role: r.role, text: r.text, status: r.status, options: r.options };
}

/** 把当前 UI 消息列表写入会话（空列表不写，保留 welcome 为虚拟消息） */
function persistSession(sessionId: string, messages: ChatMessage[]): void {
  // 过滤掉纯 welcome 的初始消息（避免历史里堆积 greet）
  const real = messages.filter((m) => !(m === INITIAL_MESSAGE));
  chatStore.setMessages(sessionId, real.map(toRecord));
}

/** 从会话记录恢复 UI 消息列表（空会话补 welcome） */
function loadSessionMessages(sessionId: string): ChatMessage[] {
  const s = chatStore.get(sessionId);
  if (!s || s.messages.length === 0) return [INITIAL_MESSAGE];
  return s.messages.map(fromRecord);
}

/** AI 回复完成后，从最近一条用户消息提取行为习惯并保存为 auto 记忆 */
function captureHabit(messages: ChatMessage[]): void {
  // 找到最后一条用户消息
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && m.text);
  if (!lastUser) return;
  const habit = extractHabit(lastUser.text);
  if (!habit) return;
  if (memoryStore.hasSimilar(habit.content)) return;
  memoryStore.add({ content: habit.content, category: habit.category, source: 'auto' });
}

/**
 * 重置当前聊天为全新会话（保留历史，仅切换到新会话）。
 * 兼容旧调用点（SettingsView 在 AI 配置变更 / 清空数据后调用）。
 */
export function resetChatHistory(): void {
  chatStore.create();
}

export function ChatView({ onChanged, onNavigateToSettings }: { onChanged: () => void; onNavigateToSettings?: () => void }) {
  // 启动时确保有 active 会话
  const initialSession = chatStore.getActive() ?? chatStore.create();
  const [activeSessionId, setActiveSessionId] = useState<string>(initialSession.id);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadSessionMessages(initialSession.id));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [quickManageOpen, setQuickManageOpen] = useState(false);
  // 资产/负债明细弹窗：'assets' | 'liabilities' | null
  const [detailView, setDetailView] = useState<'assets' | 'liabilities' | null>(null);
  // Agent 状态
  const [activeAgent, setActiveAgentState] = useState<Agent>(() => getActiveAgent());
  const [agentsOpen, setAgentsOpen] = useState(false);
  // 聊天弹框：点击首页输入框入口后打开全屏聊天弹框
  const [chatOpen, setChatOpen] = useState(false);
  // 试用配额版本号：每次调用后递增，触发剩余次数重新渲染
  const [quotaVersion, setQuotaVersion] = useState(0);
  void quotaVersion;
  const agents = listAgents();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const quickInputs = quickInputStore.list();

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 打开聊天弹框后自动聚焦输入框
  useEffect(() => {
    if (chatOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [chatOpen]);

  // 切换会话
  const switchSession = (id: string) => {
    chatStore.setActive(id);
    setActiveSessionId(id);
    setMessages(loadSessionMessages(id));
    setSessionsOpen(false);
  };

  // 切换 Agent
  const switchAgent = (a: Agent) => {
    setActiveAgent(a.id);
    setActiveAgentState(a);
    setAgentsOpen(false);
    dialog.toast(`已切换到「${a.name}」`, 'success');
  };

  // 新建会话
  const newChat = () => {
    const s = chatStore.create();
    setActiveSessionId(s.id);
    setMessages([INITIAL_MESSAGE]);
    setSessionsOpen(false);
    onChanged();
  };

  // 删除会话
  const deleteSession = async (id: string) => {
    const s = chatStore.get(id);
    if (!s) return;
    const ok = await dialog.confirm(`确定删除会话「${s.title}」？此操作不可恢复。`, '删除会话');
    if (!ok) return;
    chatStore.remove(id);
    // 如果删的是当前会话，切到新的或第一个
    if (id === activeSessionId) {
      const next = chatStore.getActive() ?? chatStore.create();
      setActiveSessionId(next.id);
      setMessages(loadSessionMessages(next.id));
    }
    onChanged();
    dialog.toast('会话已删除', 'success');
  };

  const pushAI = (text: string, status: ChatMessage['status'] = 'ai') => {
    setMessages((ms) => [...ms, { role: 'ai', text, status }]);
  };

  /** 替换最后一条 thinking/tool 气泡为新 AI 气泡（流式开始） */
  const startAIMessage = () => {
    setMessages((ms) => {
      const copy = [...ms];
      const last = copy[copy.length - 1];
      if (last?.status === 'thinking' || last?.status === 'tool') {
        copy[copy.length - 1] = { role: 'ai', text: '', status: 'ai', streaming: true };
      } else {
        copy.push({ role: 'ai', text: '', status: 'ai', streaming: true });
      }
      return copy;
    });
  };

  /** 流式追加文本（full 是累计文本，直接替换最后气泡内容） */
  const appendAIChunk = (full: string) => {
    setMessages((ms) => {
      const copy = [...ms];
      const last = copy[copy.length - 1];
      if (last?.role === 'ai' && last.status === 'ai') {
        copy[copy.length - 1] = { ...last, text: full, streaming: true };
      }
      return copy;
    });
  };

  const endAIMessage = () => {
    setMessages((ms) => {
      const copy = [...ms];
      const last = copy[copy.length - 1];
      if (last?.role === 'ai') {
        copy[copy.length - 1] = { ...last, streaming: false };
      }
      // 落库 + 习惯提取
      persistSession(activeSessionId, copy);
      captureHabit(copy);
      return copy;
    });
    onChanged();
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;

    const effectiveConfig = getEffectiveConfig();
    const useLocal = !effectiveConfig.apiKey.trim() && !effectiveConfig.proxyUrl;

    // 纯本地模式：无 API Key 且无试用代理，直接走确定性引擎，不发起网络请求
    if (useLocal) {
      setInput('');
      const userMsg: ChatMessage = { role: 'user', text: t };
      const next = [...messages, userMsg];
      setMessages(next);
      persistSession(activeSessionId, next);
      setLoading(true);
      const r = engine.handle(t);
      const aiMsg: ChatMessage = {
        role: 'ai',
        text: r.message,
        status: (r.status === 'clarify' ? 'clarify' : r.status) as ChatMessage['status'],
        options: r.clarifyOptions,
      };
      const finalMsgs = [...next, aiMsg];
      setMessages(finalMsgs);
      persistSession(activeSessionId, finalMsgs);
      onChanged();
      setLoading(false);
      return;
    }

    // 试用用户每日配额检查（用户配置了自己的 API Key 后不受限）
    if (isUsingBuiltinConfig() && !hasTrialQuota()) {
      pushAI(`今日试用次数已用完（每天 ${DAILY_TRIAL_LIMIT} 次），请明天再试或在设置中配置自己的 API Key。`, 'error');
      return;
    }

    setInput('');
    const userMsg: ChatMessage = { role: 'user', text: t };
    const next = [...messages, userMsg];
    setMessages(next);
    persistSession(activeSessionId, next);
    setLoading(true);

    const history = toAIMessages(messages);
    let thinkingShown = false;

    // 动态加载 AI 客户端（SSE 解析 + 工具调用），首屏不加载这部分代码
    const { chatWithAI } = await import('../core/ai/client');
    await chatWithAI(t, history, effectiveConfig, {
        onThinking: () => {
          if (!thinkingShown) {
            thinkingShown = true;
            pushAI('思考中...', 'thinking');
          }
        },
        onReasoning: (_delta, full) => {
          // 推理模型的思考过程，更新到思考气泡
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.status === 'thinking') {
              copy[copy.length - 1] = { ...last, text: `💭 ${full.slice(-200)}` };
            }
            return copy;
          });
        },
        onToolExecuting: (name) => {
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.status === 'thinking' || last?.status === 'tool') {
              copy[copy.length - 1] = { role: 'ai', text: `正在执行：${name}...`, status: 'tool' };
            }
            return copy;
          });
        },
        onToolResult: (result) => {
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.status === 'tool' || last?.status === 'thinking') {
              copy[copy.length - 1] = {
                role: 'ai',
                text: result.result,
                status: result.success ? 'ok' : 'error',
              };
            }
            persistSession(activeSessionId, copy);
            return copy;
          });
          onChanged();
        },
        onMessageStart: () => {
          startAIMessage();
        },
        onMessageChunk: (_delta, full) => {
          appendAIChunk(full);
        },
        onMessageEnd: () => {
          endAIMessage();
        },
        onError: (error) => {
          // AI 调用失败：尝试本地引擎回退（离线/API 不可达时仍可记账）
          const r = engine.handle(t);
          const text = r.message || `⚠️ AI 请求失败：${error}`;
          const status: ChatMessage['status'] = r.message ? (r.status as ChatMessage['status']) : 'error';
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.status === 'tool' || last?.status === 'thinking' || last?.streaming) {
              copy[copy.length - 1] = { role: 'ai', text, status, streaming: false };
            } else {
              copy.push({ role: 'ai', text, status });
            }
            persistSession(activeSessionId, copy);
            return copy;
          });
        },
      }, activeAgent);
    // 试用用户：记录一次调用，更新配额显示
    if (isUsingBuiltinConfig()) {
      recordTrialUsage();
      setQuotaVersion((v) => v + 1);
    }
    setLoading(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  /** 点击快捷输入：无占位符直接发送；有占位符填入输入框并自动选中占位符 */
  const onQuickClick = (template: string) => {
    if (loading) return;
    if (!hasAmountPlaceholder(template)) {
      void send(template);
      return;
    }
    // 含占位符：填入输入框，聚焦并选中占位符区间，用户输入数字即替换
    setInput(template);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const range = findPlaceholderRange(template);
      if (range) {
        el.setSelectionRange(range[0], range[1]);
      }
    });
  };

  // 快捷输入管理：增删改
  const addQuickInput = async () => {
    const template = await dialog.prompt(
      '新建快捷输入（可用 {金额} 作为占位符）',
      `早餐 ${AMOUNT_PLACEHOLDER} 元`,
      '如：早餐 {金额} 元',
      '新建快捷输入',
    );
    if (!template) return;
    if (!quickInputStore.add(template)) {
      await dialog.alert('添加失败：内容为空或超出上限（30 条）', '操作失败');
      return;
    }
    onChanged();
    dialog.toast('已添加快捷输入', 'success');
  };

  const editQuickInput = async (id: string, current: string) => {
    const template = await dialog.prompt('编辑快捷输入', current, '快捷输入内容', '编辑快捷输入');
    if (template === null) return;
    if (!quickInputStore.update(id, template)) {
      await dialog.alert('更新失败：内容为空', '操作失败');
      return;
    }
    onChanged();
    dialog.toast('已更新', 'success');
  };

  const deleteQuickInput = async (id: string, current: string) => {
    const ok = await dialog.confirm(`删除快捷输入「${current}」？`, '删除快捷输入');
    if (!ok) return;
    quickInputStore.remove(id);
    onChanged();
    dialog.toast('已删除', 'success');
  };

  const resetQuickInputs = async () => {
    const ok = await dialog.confirm('恢复为默认快捷输入？当前自定义内容将被覆盖。', '恢复默认');
    if (!ok) return;
    quickInputStore.resetToDefaults();
    onChanged();
    dialog.toast('已恢复默认', 'success');
  };

  // 本地引擎的确认/取消
  const handleLocalConfirm = () => {
    const userMsg: ChatMessage = { role: 'user', text: '确认' };
    const next = [...messages, userMsg];
    setMessages(next);
    const r = engine.confirmPending();
    const finalMsgs = [...next, { role: 'ai' as const, text: r.message, status: r.status as ChatMessage['status'] }];
    setMessages(finalMsgs);
    persistSession(activeSessionId, finalMsgs);
    onChanged();
  };

  const handleLocalCancel = () => {
    const userMsg: ChatMessage = { role: 'user', text: '取消' };
    const next = [...messages, userMsg];
    setMessages(next);
    const r = engine.cancelPending();
    const finalMsgs = [...next, { role: 'ai' as const, text: r.message, status: r.status as ChatMessage['status'] }];
    setMessages(finalMsgs);
    persistSession(activeSessionId, finalMsgs);
  };

  const totalAssets = store.getTotalAssets();
  const totalLiabilities = store.getTotalLiabilities();
  const sessions = chatStore.list();
  const activeSession = chatStore.get(activeSessionId);

  /** 关闭聊天弹框 */
  const closeChat = () => {
    setChatOpen(false);
    inputRef.current?.blur();
  };

  /** 点击试用提示横幅：关闭聊天弹框，跳转到设置页 AI 配置区 */
  const goToAIConfig = () => {
    setChatOpen(false);
    onNavigateToSettings?.();
  };

  // 资产/负债账户分组
  const ASSET_TYPES = ['wallet', 'alipay', 'cash', 'debit'];
  const assetAccounts = store.state.accounts.filter((a) => ASSET_TYPES.includes(a.type));
  const liabilityAccounts = store.state.accounts.filter(
    (a) => a.type === 'credit' || a.type === 'installment' || a.type === 'loan',
  );

  const ACCOUNT_TYPE_LABEL: Record<string, string> = {
    wallet: '钱包', alipay: '支付宝', cash: '现金', debit: '储蓄卡',
    credit: '信用卡', loan: '贷款', installment: '分期',
  };

  const usingBuiltin = isUsingBuiltinConfig();
  const trialReady = isTrialAvailable();
  const inputPlaceholder = usingBuiltin
    ? (trialReady
        ? '输入消息，AI 帮你记账（试用中）...'
        : '输入消息，离线也能记账（本地解析，无需联网）...')
    : '输入消息，AI 帮你记账...';

  // 近期流水（首页中间展示）
  const recentTxs = [...store.state.transactions]
    .sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')))
    .slice(0, 5);

  return (
    <div className="chat-view">
      {/* 首页：总览 + 近期流水 + 输入框入口 */}
      <div className="overview">
        <button
          type="button"
          className="overview-cell"
          onClick={() => setDetailView('assets')}
          aria-label={`总资产 ¥${formatMoney(totalAssets)}，查看明细`}
        >
          <span className="overview-label">总资产</span>
          <span className="overview-value">¥{formatMoney(totalAssets)}</span>
        </button>
        <button
          type="button"
          className="overview-cell"
          onClick={() => setDetailView('liabilities')}
          aria-label={`总负债 ¥${formatMoney(totalLiabilities)}，查看明细`}
        >
          <span className="overview-label">总负债</span>
          <span className="overview-value negative">¥{formatMoney(totalLiabilities)}</span>
        </button>
      </div>

      {/* 中间区域：近期流水记录，填充空白 */}
      <div className="recent-section">
        <div className="recent-header">
          <span className="recent-title">近期流水</span>
        </div>
        {recentTxs.length === 0 ? (
          <div className="recent-empty">暂无流水，点击下方输入框开始记账</div>
        ) : (
          <ul className="recent-list">
            {recentTxs.map((t: Transaction) => {
              const acc = store.getAccount(t.accountId);
              const isIncome = t.type === 'income' || t.type === 'refund';
              const sign = isIncome ? '+' : '-';
              return (
                <li key={t.id} className="recent-item">
                  <div className="recent-item-main">
                    <span className="recent-item-desc">{t.description || t.category}</span>
                    <span className="recent-item-meta">
                      {t.date} · {acc?.name ?? '?'}
                    </span>
                  </div>
                  <span className={`recent-item-amount ${isIncome ? 'positive' : 'negative'}`}>
                    {sign}¥{formatMoney(t.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 输入框入口：固定在 tab-bar 上方，方便单手点击 */}
      <button
        type="button"
        className="chat-entry"
        onClick={() => setChatOpen(true)}
      >
        <Icon name="chat" size={18} className="chat-entry-icon" />
        <span className="chat-entry-placeholder">{inputPlaceholder}</span>
      </button>

      {/* 快捷输入管理弹窗 */}
      {quickManageOpen && (
        <div className="modal-overlay" onClick={() => setQuickManageOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">管理快捷输入</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setQuickManageOpen(false)}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-tip">提示：使用 <code>{'{金额}'}</code> 作为占位符，点击该快捷输入时会自动选中让用户填入金额。</div>
              <div className="quick-list">
                {quickInputs.length === 0 && <div className="empty">暂无快捷输入</div>}
                {quickInputs.map((q) => (
                  <div key={q.id} className="quick-item">
                    <div className="quick-item-template">{q.template}</div>
                    <div className="quick-item-actions">
                      <button type="button" aria-label="编辑" onClick={() => void editQuickInput(q.id, q.template)}>
                        <Icon name="edit" size={16} />
                      </button>
                      <button type="button" aria-label="删除" className="danger" onClick={() => void deleteQuickInput(q.id, q.template)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => void resetQuickInputs()}>恢复默认</button>
              <button type="button" onClick={() => void addQuickInput()} className="primary">
                <Icon name="plus" size={16} /> 新建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 资产/负债明细弹窗 */}
      {detailView && (
        <div className="modal-overlay" onClick={() => setDetailView(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {detailView === 'assets' ? '资产明细' : '负债明细'}
              </span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setDetailView(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-summary">
                <span className="detail-summary-label">
                  {detailView === 'assets' ? '总资产' : '总负债'}
                </span>
                <span className={`detail-summary-value${detailView === 'liabilities' ? ' negative' : ''}`}>
                  ¥{formatMoney(detailView === 'assets' ? totalAssets : totalLiabilities)}
                </span>
              </div>
              <ul className="detail-account-list">
                {(detailView === 'assets' ? assetAccounts : liabilityAccounts).length === 0 && (
                  <li className="empty">暂无{detailView === 'assets' ? '资产' : '负债'}账户</li>
                )}
                {(detailView === 'assets' ? assetAccounts : liabilityAccounts).map((a: Account) => (
                  <li key={a.id} className="detail-account-item">
                    <div className="detail-account-main">
                      <span className="detail-account-name">{a.name}</span>
                      <span className="detail-account-type">{ACCOUNT_TYPE_LABEL[a.type] ?? a.type}</span>
                    </div>
                    <span className={`detail-account-balance${detailView === 'liabilities' ? ' negative' : ''}`}>
                      ¥{formatMoney(a.balance)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 全屏聊天弹框：用 Portal 渲染到 document.body，彻底脱离父级层级 */}
      <FullscreenModal open={chatOpen} onClose={closeChat}>
        <div className="chat-modal">
          {/* 弹框顶栏：会话工具栏 + 关闭按钮 */}
          <div className="chat-modal-header">
            <button
              type="button"
              className="chat-toolbar-btn"
              aria-expanded={sessionsOpen}
              aria-label="会话列表"
              onClick={() => { setSessionsOpen((v) => !v); setAgentsOpen(false); }}
            >
              <Icon name="menu" size={20} />
            </button>
            <button
              type="button"
              className={`agent-pill${agentsOpen ? ' open' : ''}`}
              aria-expanded={agentsOpen}
              aria-label="切换 Agent"
              onClick={() => { setAgentsOpen((v) => !v); setSessionsOpen(false); }}
              title={activeAgent.description}
            >
              <Icon name="bolt" size={14} className="agent-pill-icon" />
              <span className="agent-pill-name">{activeAgent.name}</span>
              <Icon name="chevron" size={14} rotate={agentsOpen ? 180 : 0} className="agent-pill-chevron" />
            </button>
            <span className="chat-title" title={activeSession?.title}>{activeSession?.title ?? '对话'}</span>
            <button type="button" className="chat-toolbar-btn" aria-label="新建聊天" onClick={newChat} disabled={loading}>
              <Icon name="plus" size={20} />
            </button>
            <button
              type="button"
              className="chat-modal-close"
              aria-label="关闭聊天"
              onClick={closeChat}
            >
              <Icon name="close" size={22} />
            </button>
          </div>
          {agentsOpen && (
            <div className="agent-list">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`agent-item${a.id === activeAgent.id ? ' active' : ''}`}
                  onClick={() => switchAgent(a)}
                >
                  <div className="agent-item-main">
                    <div className="agent-item-name">{a.name}</div>
                    <div className="agent-item-desc">{a.description}</div>
                  </div>
                  {a.id === activeAgent.id && <span className="agent-item-check">✓</span>}
                </button>
              ))}
            </div>
          )}
          {sessionsOpen && (
            <div className="chat-sessions">
              {sessions.length === 0 && <div className="empty">暂无会话</div>}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`chat-session-item ${s.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => switchSession(s.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="chat-session-main">
                    <div className="chat-session-title">{s.title || '新对话'}</div>
                    <div className="chat-session-meta">
                      {s.messages.length} 条消息 · {new Date(s.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="chat-session-del"
                    aria-label="删除会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteSession(s.id);
                    }}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 试用用户提示横幅：基础模型能力较弱，引导配置自己的模型 */}
          {usingBuiltin && (
            <button type="button" className="trial-banner" onClick={goToAIConfig}>
              <span className="trial-banner-icon">💡</span>
              <span className="trial-banner-text">
                当前使用基础模型，能力较弱。添加你自己的 API Key 可获得更强能力
                <span className="trial-banner-link">去配置 ›</span>
              </span>
              <span className="trial-banner-quota">
                今日剩余 {isUsingBuiltinConfig() ? getTrialRemaining() : DAILY_TRIAL_LIMIT}/{DAILY_TRIAL_LIMIT}
              </span>
            </button>
          )}

          {/* 消息列表 */}
          <div className="chat-list" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble-row ${m.role}`}>
                <div className={`bubble ${m.role} ${m.status ?? ''} ${m.streaming ? 'streaming' : ''}`}>
                  {m.text}
                  {m.streaming && <span className="stream-cursor">▍</span>}
                  {m.options && (
                    <div className="quick-options">
                      {m.options.map((o) => (
                        <button key={o} type="button" disabled={loading} onClick={() => void send(o)}>
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.status === 'confirm' && (
                    <div className="quick-options">
                      <button type="button" onClick={handleLocalConfirm}>确认</button>
                      <button type="button" onClick={handleLocalCancel}>取消</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 底栏：快捷输入 + 真实输入框 */}
          <div className="chat-footer">
            <div className={`samples-wrap ${samplesOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="samples-toggle"
                aria-expanded={samplesOpen}
                aria-label="快捷输入"
                onClick={() => setSamplesOpen((v) => !v)}
              >
                <Icon name="bolt" size={16} className="samples-toggle-bolt" />
                <span className="samples-toggle-text">快捷输入</span>
                <Icon
                  name="chevron"
                  size={16}
                  rotate={samplesOpen ? 180 : 0}
                  className="samples-toggle-icon"
                />
              </button>
              {samplesOpen && (
                <div className="samples">
                  {quickInputs.length === 0 && <div className="samples-empty">暂无快捷输入，点击「管理」添加</div>}
                  {quickInputs.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      disabled={loading}
                      onClick={() => onQuickClick(q.template)}
                      title={hasAmountPlaceholder(q.template) ? '点击后填写金额' : '点击直接发送'}
                    >
                      {q.template}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="samples-manage-btn"
                    onClick={() => setQuickManageOpen(true)}
                  >
                    管理
                  </button>
                </div>
              )}
            </div>
            <form className="chat-input" onSubmit={onSubmit}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={inputPlaceholder}
                aria-label="记账输入"
                disabled={loading}
              />
              <button type="submit" disabled={loading || !input.trim()} aria-label="发送">
                {loading ? <span className="chat-send-loading">…</span> : <Icon name="send" size={18} />}
              </button>
            </form>
          </div>
        </div>
      </FullscreenModal>
    </div>
  );
}

// 转换为 AI API 的历史消息格式
function toAIMessages(messages: ChatMessage[]): AIMessage[] {
  return messages
    .filter((m) => m.role === 'user' || (m.role === 'ai' && m.text))
    .slice(-10) // 只取最近10条，控制 token
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
}
