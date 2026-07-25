import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type EngineResult, formatMoney } from '../core/engine/engine';
import { engine, store } from './appState';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  status?: EngineResult['status'];
  options?: string[];
}

const SAMPLES = ['中午吃了碗面25', '3k工资到账', '微信还有多少余额', '这个月花了多少'];

export function ChatView({ onChanged }: { onChanged: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ai', text: '你好，我是记账助手。直接说「吃午饭25」就能记账。' },
  ]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const pushResult = (r: EngineResult) => {
    setMessages((ms) => [...ms, { role: 'ai', text: r.message, status: r.status, options: r.clarifyOptions }]);
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setMessages((ms) => [...ms, { role: 'user', text: t }]);
    const r = engine.handle(t);
    pushResult(r);
    setInput('');
    onChanged();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
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
            <div className={`bubble ${m.role} ${m.status ?? ''}`}>
              {m.text}
              {m.options && (
                <div className="quick-options">
                  {m.options.map((o) => (
                    <button key={o} type="button" onClick={() => send(o)}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
              {m.status === 'confirm' && (
                <div className="quick-options">
                  <button
                    type="button"
                    onClick={() => {
                      setMessages((ms) => [...ms, { role: 'user', text: '确认' }]);
                      pushResult(engine.confirmPending());
                      onChanged();
                    }}
                  >
                    确认
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMessages((ms) => [...ms, { role: 'user', text: '取消' }]);
                      pushResult(engine.cancelPending());
                      onChanged();
                    }}
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="samples">
        {SAMPLES.map((s) => (
          <button key={s} type="button" onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="说一句话就记账，如：打车30"
          aria-label="记账输入"
        />
        <button type="submit">发送</button>
      </form>
    </div>
  );
}
