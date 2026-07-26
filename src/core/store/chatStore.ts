/**
 * AI 聊天会话仓库：多会话持久化
 *
 * 设计原则（卡帕西视角）：
 * - 持久化形状与 UI 状态分离：streaming/options 等瞬态字段不入库，只存 role/text/status
 * - 标题自动生成：取首条用户消息前 20 字，避免空标题
 * - 软上限：单会话消息数无强限（AI 历史已在上层裁剪到最近 10 条），会话总数 50 上限 FIFO
 */
import { createId } from '../utils/id';
import { monotonicNowIso } from '../utils/now';

export type ChatRole = 'user' | 'ai';
export type ChatStatus = 'ok' | 'error' | 'confirm' | 'thinking' | 'tool' | 'ai';

/** 持久化的消息形状（剥离 streaming 等瞬态字段） */
export interface ChatMessageRecord {
  id: string;
  role: ChatRole;
  text: string;
  status?: ChatStatus;
  options?: string[];
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessageRecord[];
  createdAt: string;
  updatedAt: string;
}

interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class LocalStorageAdapter implements StorageAdapter {
  getItem(key: string): string | null {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  setItem(key: string, value: string): void {
    globalThis.localStorage?.setItem(key, value);
  }
  removeItem(key: string): void {
    globalThis.localStorage?.removeItem(key);
  }
}

/** 测试用：内存版 adapter */
export class ChatMemoryStorageAdapter implements StorageAdapter {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const STORAGE_KEY = 'accounting-ai:chats:v1';
const MAX_SESSIONS = 50;
const TITLE_MAX = 20;

export class ChatStore {
  private sessions: ChatSession[] = [];
  private activeId: string | null = null;
  private storage: StorageAdapter;

  constructor(storage?: StorageAdapter) {
    this.storage =
      storage ??
      (typeof globalThis.localStorage !== 'undefined'
        ? new LocalStorageAdapter()
        : new ChatMemoryStorageAdapter());
    this.load();
  }

  list(): ChatSession[] {
    return [...this.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): ChatSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  getActive(): ChatSession | undefined {
    if (!this.activeId) return this.sessions[0];
    return this.get(this.activeId);
  }

  setActive(id: string): void {
    if (this.get(id)) this.activeId = id;
  }

  /** 创建新会话，自动设为 active */
  create(title?: string): ChatSession {
    const now = monotonicNowIso();
    const session: ChatSession = {
      id: createId('chat'),
      title: title?.trim() || '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.unshift(session);
    this.activeId = session.id;
    // 超限时淘汰最早的（保留 active）
    if (this.sessions.length > MAX_SESSIONS) {
      const sorted = [...this.sessions].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const toRemove = sorted.slice(0, this.sessions.length - MAX_SESSIONS).filter((s) => s.id !== session.id);
      const ids = new Set(toRemove.map((s) => s.id));
      this.sessions = this.sessions.filter((s) => !ids.has(s.id));
    }
    this.save();
    return session;
  }

  /** 重命名会话 */
  rename(id: string, title: string): ChatSession | null {
    const s = this.get(id);
    if (!s) return null;
    s.title = title.trim() || s.title;
    s.updatedAt = monotonicNowIso();
    this.save();
    return s;
  }

  /** 追加消息到会话，自动更新标题（首条用户消息）与 updatedAt */
  appendMessage(sessionId: string, msg: Omit<ChatMessageRecord, 'id' | 'createdAt'>): ChatMessageRecord | null {
    const s = this.get(sessionId);
    if (!s) return null;
    const record: ChatMessageRecord = {
      id: createId('msg'),
      createdAt: monotonicNowIso(),
      ...msg,
    };
    s.messages.push(record);
    s.updatedAt = record.createdAt;
    // 首条用户消息自动作为标题
    if (msg.role === 'user' && (s.title === '新对话' || !s.title)) {
      s.title = msg.text.slice(0, TITLE_MAX) + (msg.text.length > TITLE_MAX ? '…' : '');
    }
    this.save();
    return record;
  }

  /** 替换会话的全部消息（用于流式更新最终落库） */
  setMessages(sessionId: string, messages: Array<Omit<ChatMessageRecord, 'id' | 'createdAt'>>): void {
    const s = this.get(sessionId);
    if (!s) return;
    const now = monotonicNowIso();
    s.messages = messages.map((m) => ({
      id: createId('msg'),
      createdAt: now,
      ...m,
    }));
    s.updatedAt = now;
    if (s.messages.length > 0) {
      const firstUser = s.messages.find((m) => m.role === 'user');
      if (firstUser && (s.title === '新对话' || !s.title)) {
        s.title = firstUser.text.slice(0, TITLE_MAX) + (firstUser.text.length > TITLE_MAX ? '…' : '');
      }
    }
    this.save();
  }

  /** 删除单条消息 */
  removeMessage(sessionId: string, messageId: string): ChatMessageRecord | null {
    const s = this.get(sessionId);
    if (!s) return null;
    const idx = s.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return null;
    const [removed] = s.messages.splice(idx, 1);
    this.save();
    return removed;
  }

  /** 清空会话内全部消息，但保留会话 */
  clearMessages(sessionId: string): void {
    const s = this.get(sessionId);
    if (!s) return;
    s.messages = [];
    s.updatedAt = monotonicNowIso();
    this.save();
  }

  /** 删除整个会话 */
  remove(sessionId: string): ChatSession | null {
    const idx = this.sessions.findIndex((s) => s.id === sessionId);
    if (idx < 0) return null;
    const [removed] = this.sessions.splice(idx, 1);
    if (this.activeId === sessionId) {
      this.activeId = this.sessions[0]?.id ?? null;
    }
    this.save();
    return removed;
  }

  clearAll(): void {
    this.sessions = [];
    this.activeId = null;
    this.storage.removeItem(STORAGE_KEY);
  }

  load(): boolean {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      const data = JSON.parse(raw) as { sessions?: ChatSession[]; activeId?: string };
      if (!data || !Array.isArray(data.sessions)) return false;
      this.sessions = data.sessions.filter(
        (s) => s && typeof s.id === 'string' && Array.isArray(s.messages),
      );
      this.activeId = data.activeId ?? this.sessions[0]?.id ?? null;
      return true;
    } catch {
      return false;
    }
  }

  save(): void {
    this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessions: this.sessions, activeId: this.activeId }),
    );
  }
}
