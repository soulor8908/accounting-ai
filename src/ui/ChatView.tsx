import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type EngineResult, formatMoney } from '../core/engine/engine';
import { type AIConfig, defaultConfig, loadAIConfig } from '../core/ai/config';
import { type ChatMessage as AIMessage, chatWithAI } from '../core/ai/client';
import { extractHabit } from '../core/ai/habits';
import {
  AMOUNT_PLACEHOLDER,
  findPlaceholderRange,
  hasAmountPlaceholder,
} from '../core/store/quickInput';
import { chatStore, engine, memoryStore, quickInputStore, store } from './appState';
import type { ChatMessageRecord } from '../core/store/chatStore';

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

export function ChatView({ onChanged }: { onChanged: () => void }) {
  // 启动时确保有 active 会话
  const initialSession = chatStore.getActive() ?? chatStore.create();
  const [activeSessionId, setActiveSessionId] = useState<string>(initialSession.id);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadSessionMessages(initialSession.id));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [quickManageOpen, setQuickManageOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const quickInputs = quickInputStore.list();

  useEffect(() => {
    setAIConfig(loadAIConfig() ?? defaultConfig());
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 切换会话
  const switchSession = (id: string) => {
    chatStore.setActive(id);
    setActiveSessionId(id);
    setMessages(loadSessionMessages(id));
    setSessionsOpen(false);
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
  const deleteSession = (id: string) => {
    const s = chatStore.get(id);
    if (!s) return;
    if (!window.confirm(`确定删除会话「${s.title}」？此操作不可恢复。`)) return;
    chatStore.remove(id);
    // 如果删的是当前会话，切到新的或第一个
    if (id === activeSessionId) {
      const next = chatStore.getActive() ?? chatStore.create();
      setActiveSessionId(next.id);
      setMessages(loadSessionMessages(next.id));
    }
    onChanged();
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
    setInput('');
    const userMsg: ChatMessage = { role: 'user', text: t };
    const next = [...messages, userMsg];
    setMessages(next);
    persistSession(activeSessionId, next);
    setLoading(true);

    // 优先使用 AI
    if (aiConfig?.apiKey) {
      const history = toAIMessages(messages);
      let thinkingShown = false;

      await chatWithAI(t, history, aiConfig, {
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
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.status === 'tool' || last?.status === 'thinking' || last?.streaming) {
              copy[copy.length - 1] = { role: 'ai', text: `⚠️ ${error}`, status: 'error', streaming: false };
            } else {
              copy.push({ role: 'ai', text: `⚠️ ${error}`, status: 'error' });
            }
            persistSession(activeSessionId, copy);
            return copy;
          });
        },
      });
      setLoading(false);
      return;
    }

    // Fallback: 本地引擎
    const r = engine.handle(t);
    const finalMsgs = [...next, { role: 'ai' as const, text: r.message, status: r.status as ChatMessage['status'], options: r.clarifyOptions }];
    setMessages(finalMsgs);
    persistSession(activeSessionId, finalMsgs);
    captureHabit(finalMsgs);
    onChanged();
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
  const addQuickInput = () => {
    const template = window.prompt('新建快捷输入（可用 {金额} 作为占位符）', `早餐 ${AMOUNT_PLACEHOLDER} 元`);
    if (!template) return;
    if (!quickInputStore.add(template)) {
      window.alert('添加失败：内容为空或超出上限（30 条）');
      return;
    }
    onChanged();
  };

  const editQuickInput = (id: string, current: string) => {
    const template = window.prompt('编辑快捷输入', current);
    if (template === null) return;
    if (!quickInputStore.update(id, template)) {
      window.alert('更新失败：内容为空');
      return;
    }
    onChanged();
  };

  const deleteQuickInput = (id: string, current: string) => {
    if (!window.confirm(`删除快捷输入「${current}」？`)) return;
    quickInputStore.remove(id);
    onChanged();
  };

  const resetQuickInputs = () => {
    if (!window.confirm('恢复为默认快捷输入？当前自定义内容将被覆盖。')) return;
    quickInputStore.resetToDefaults();
    onChanged();
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

  return (
    <div className="chat-view">
      <div className="overview">
        <div>
          <span className="overview-label">总资产</span>
          <span className="overview-value">¥{formatMoney(totalAssets)}</span>
        </div>
        <div>
          <span className="overview-label">总负债</span>
          <span className="overview-value negative">¥{formatMoney(totalLiabilities)}</span>
        </div>
      </div>

      {/* 会话工具栏：切换 / 标题 / 新建 */}
      <div className="chat-toolbar">
        <button
          type="button"
          className="chat-toolbar-btn"
          aria-expanded={sessionsOpen}
          aria-label="会话列表"
          onClick={() => setSessionsOpen((v) => !v)}
        >
          ☰
        </button>
        <span className="chat-title" title={activeSession?.title}>{activeSession?.title ?? '对话'}</span>
        <button type="button" className="chat-toolbar-btn" aria-label="新建聊天" onClick={newChat} disabled={loading}>
          ＋
        </button>
      </div>
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
                  deleteSession(s.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

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
      {/* 固定底栏：快捷输入折叠 + 输入框，不随页面滚动 */}
      <div className="chat-footer">
        <div className={`samples-wrap ${samplesOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="samples-toggle"
            aria-expanded={samplesOpen}
            aria-label="快捷输入"
            onClick={() => setSamplesOpen((v) => !v)}
          >
            <span className="samples-toggle-icon">{samplesOpen ? '▾' : '▴'}</span>
            快捷输入
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
            placeholder={aiConfig?.apiKey ? '输入消息，AI 帮你记账...' : '说一句话就记账，如：打车30（未配置AI，使用本地解析）'}
            aria-label="记账输入"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? '...' : '发送'}
          </button>
        </form>
      </div>

      {/* 快捷输入管理弹窗 */}
      {quickManageOpen && (
        <div className="modal-overlay" onClick={() => setQuickManageOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">管理快捷输入</span>
              <button type="button" className="modal-close" onClick={() => setQuickManageOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="modal-tip">提示：使用 <code>{'{金额}'}</code> 作为占位符，点击该快捷输入时会自动选中让用户填入金额。</div>
              <div className="quick-list">
                {quickInputs.length === 0 && <div className="empty">暂无快捷输入</div>}
                {quickInputs.map((q) => (
                  <div key={q.id} className="quick-item">
                    <div className="quick-item-template">{q.template}</div>
                    <div className="quick-item-actions">
                      <button type="button" onClick={() => editQuickInput(q.id, q.template)}>编辑</button>
                      <button type="button" onClick={() => deleteQuickInput(q.id, q.template)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" onClick={resetQuickInputs}>恢复默认</button>
              <button type="button" onClick={addQuickInput} className="primary">+ 新建</button>
            </div>
          </div>
        </div>
      )}
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
