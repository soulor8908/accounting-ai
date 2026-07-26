import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type EngineResult, formatMoney } from '../core/engine/engine';
import { type AIConfig, defaultConfig, loadAIConfig } from '../core/ai/config';
import { type ChatMessage as AIMessage, chatWithAI } from '../core/ai/client';
import { engine, store } from './appState';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  status?: EngineResult['status'] | 'thinking' | 'tool' | 'ai';
  options?: string[];
  /** 流式输出中 */
  streaming?: boolean;
}

const SAMPLES = ['中午吃了碗面25', '3k工资到账', '微信还有多少余额', '这个月花了多少'];

const INITIAL_MESSAGE: ChatMessage = { role: 'ai', text: '你好，我是记账助手。直接说「吃午饭25」就能记账，也可以问我「这个月花了多少」。' };
let cachedMessages: ChatMessage[] = [INITIAL_MESSAGE];

export function resetChatHistory() {
  cachedMessages = [INITIAL_MESSAGE];
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

export function ChatView({ onChanged }: { onChanged: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(cachedMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cachedMessages = messages;
  }, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setAIConfig(loadAIConfig() ?? defaultConfig());
  }, []);

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
      return copy;
    });
    onChanged();
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setInput('');
    setMessages((ms) => [...ms, { role: 'user', text: t }]);
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
            return copy;
          });
        },
      });
      setLoading(false);
      return;
    }

    // Fallback: 本地引擎
    const r = engine.handle(t);
    setMessages((ms) => [...ms, { role: 'ai', text: r.message, status: r.status, options: r.clarifyOptions }]);
    onChanged();
    setLoading(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  // 本地引擎的确认/取消
  const handleLocalConfirm = () => {
    setMessages((ms) => [...ms, { role: 'user', text: '确认' }]);
    const r = engine.confirmPending();
    setMessages((ms) => [...ms, { role: 'ai', text: r.message, status: r.status }]);
    onChanged();
  };

  const handleLocalCancel = () => {
    setMessages((ms) => [...ms, { role: 'user', text: '取消' }]);
    const r = engine.cancelPending();
    setMessages((ms) => [...ms, { role: 'ai', text: r.message, status: r.status }]);
  };

  const totalAssets = store.getTotalAssets();
  const totalLiabilities = store.getTotalLiabilities();

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
              {SAMPLES.map((s) => (
                <button key={s} type="button" disabled={loading} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <form className="chat-input" onSubmit={onSubmit}>
          <input
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
    </div>
  );
}
