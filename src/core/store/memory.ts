/**
 * AI 记忆仓库：用户长期偏好 / 事实 / 行为习惯
 *
 * 设计原则（卡帕西视角）：
 * - 与财务 AppState 解耦：记忆是 AI 上下文辅助数据，不参与账户余额计算，单独持久化
 * - 来源双轨：manual（用户手动添加）+ auto（聊天后启发式提取），均可被用户编辑/删除
 * - 去重：auto 记忆写入前与已有记忆做归一化相似度比较，避免重复堆积
 */
import { createId } from '../utils/id';
import { monotonicNowIso } from '../utils/now';

export type MemoryCategory = 'fact' | 'habit' | 'preference';
export type MemorySource = 'manual' | 'auto';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryInput {
  content: string;
  category?: MemoryCategory;
  source?: MemorySource;
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
export class MemoryStorageAdapter implements StorageAdapter {
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

const STORAGE_KEY = 'accounting-ai:memories:v1';
/** auto 记忆上限：FIFO 淘汰，避免无限膨胀 */
const MAX_AUTO_MEMORIES = 30;

/** 归一化：去标点、去空白、转小写，用于相似度比较 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s.,，。、！!?？:：;；]/g, '');
}

/** 简易包含相似度：a 包含 b 或 b 包含 a 即视为重复 */
export function isSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

export class MemoryStore {
  private memories: Memory[] = [];
  private storage: StorageAdapter;

  constructor(storage?: StorageAdapter) {
    this.storage =
      storage ??
      (typeof globalThis.localStorage !== 'undefined'
        ? new LocalStorageAdapter()
        : new MemoryStorageAdapter());
    this.load();
  }

  list(): Memory[] {
    return [...this.memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listByCategory(category: MemoryCategory): Memory[] {
    return this.list().filter((m) => m.category === category);
  }

  get(id: string): Memory | undefined {
    return this.memories.find((m) => m.id === id);
  }

  /** 是否已存在相似内容（用于 auto 记忆去重） */
  hasSimilar(content: string): boolean {
    return this.memories.some((m) => isSimilar(m.content, content));
  }

  add(input: MemoryInput): Memory {
    const now = monotonicNowIso();
    const memory: Memory = {
      id: createId('mem'),
      content: input.content.trim(),
      category: input.category ?? 'fact',
      source: input.source ?? 'manual',
      createdAt: now,
      updatedAt: now,
    };
    this.memories.push(memory);
    // auto 记忆超限时淘汰最早的 auto 记忆
    if (memory.source === 'auto') this.evictAuto();
    this.save();
    return memory;
  }

  update(id: string, patch: Partial<Pick<Memory, 'content' | 'category'>>): Memory | null {
    const m = this.get(id);
    if (!m) return null;
    if (patch.content !== undefined) m.content = patch.content.trim();
    if (patch.category !== undefined) m.category = patch.category;
    m.updatedAt = monotonicNowIso();
    this.save();
    return m;
  }

  remove(id: string): Memory | null {
    const idx = this.memories.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    const [removed] = this.memories.splice(idx, 1);
    this.save();
    return removed;
  }

  clearAll(): void {
    this.memories = [];
    this.storage.removeItem(STORAGE_KEY);
  }

  /** 淘汰最早的 auto 记忆，保留 manual */
  private evictAuto(): void {
    const autoMemories = this.memories.filter((m) => m.source === 'auto');
    if (autoMemories.length <= MAX_AUTO_MEMORIES) return;
    autoMemories
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, autoMemories.length - MAX_AUTO_MEMORIES)
      .forEach((m) => {
        const idx = this.memories.findIndex((x) => x.id === m.id);
        if (idx >= 0) this.memories.splice(idx, 1);
      });
  }

  load(): boolean {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      const arr = JSON.parse(raw) as Memory[];
      if (!Array.isArray(arr)) return false;
      this.memories = arr.filter((m) => m && typeof m.id === 'string' && typeof m.content === 'string');
      return true;
    } catch {
      return false;
    }
  }

  save(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.memories));
  }
}
