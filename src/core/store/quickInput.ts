/**
 * 快捷输入仓库：用户可自定义的聊天快捷短语
 *
 * 设计原则（卡帕西视角）：
 * - 极简数据结构：每个条目只有 id + template，避免过度设计
 * - 占位符约定：模板中可用 `{金额}` 表示需要用户填写的数字位置
 *   - 无占位符：点击直接发送
 *   - 有占位符：填入输入框并自动选中占位符区间，用户输入数字即替换
 * - 默认值：首次启动注入 6 条常用快捷输入（地铁/早餐/高铁/京东/拼多多）
 * - 持久化：独立 localStorage key，不进入加密 AppState
 */
import { createId } from '../utils/id';

export interface QuickInput {
  id: string;
  /** 模板，可包含 {金额} 占位符 */
  template: string;
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
export class QuickInputMemoryStorageAdapter implements StorageAdapter {
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

const STORAGE_KEY = 'accounting-ai:quick-inputs:v1';
/** 占位符 token：模板中出现该字符串时表示需要用户填入金额 */
export const AMOUNT_PLACEHOLDER = '{金额}';
const MAX_ITEMS = 30;

/** 默认快捷输入：首次启动注入 */
const DEFAULTS: Omit<QuickInput, 'id'>[] = [
  { template: '坐地铁上班7元' },
  { template: '坐地铁下班7元' },
  { template: `早餐 ${AMOUNT_PLACEHOLDER} 元` },
  { template: '高铁票39元' },
  { template: `京东买 ${AMOUNT_PLACEHOLDER} 元` },
  { template: `拼多多买 ${AMOUNT_PLACEHOLDER} 元` },
];

export class QuickInputStore {
  private items: QuickInput[] = [];
  private storage: StorageAdapter;

  constructor(storage?: StorageAdapter) {
    this.storage =
      storage ??
      (typeof globalThis.localStorage !== 'undefined'
        ? new LocalStorageAdapter()
        : new QuickInputMemoryStorageAdapter());
    if (!this.load()) {
      // 首次启动：注入默认值
      this.items = DEFAULTS.map((d) => ({ id: createId('qi'), ...d }));
      this.save();
    }
  }

  list(): QuickInput[] {
    return [...this.items];
  }

  get(id: string): QuickInput | undefined {
    return this.items.find((q) => q.id === id);
  }

  add(template: string): QuickInput | null {
    const t = template.trim();
    if (!t) return null;
    if (this.items.length >= MAX_ITEMS) return null;
    const item: QuickInput = { id: createId('qi'), template: t };
    this.items.push(item);
    this.save();
    return item;
  }

  update(id: string, template: string): QuickInput | null {
    const t = template.trim();
    if (!t) return null;
    const item = this.get(id);
    if (!item) return null;
    item.template = t;
    this.save();
    return item;
  }

  remove(id: string): QuickInput | null {
    const idx = this.items.findIndex((q) => q.id === id);
    if (idx < 0) return null;
    const [removed] = this.items.splice(idx, 1);
    this.save();
    return removed;
  }

  /** 重置为默认快捷输入（用于"恢复默认"） */
  resetToDefaults(): void {
    this.items = DEFAULTS.map((d) => ({ id: createId('qi'), ...d }));
    this.save();
  }

  clearAll(): void {
    this.items = [];
    this.storage.removeItem(STORAGE_KEY);
  }

  load(): boolean {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      const arr = JSON.parse(raw) as QuickInput[];
      if (!Array.isArray(arr)) return false;
      this.items = arr.filter(
        (q) => q && typeof q.id === 'string' && typeof q.template === 'string',
      );
      return true;
    } catch {
      return false;
    }
  }

  save(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.items));
  }
}

/**
 * 工具：判断模板是否含金额占位符
 */
export function hasAmountPlaceholder(template: string): boolean {
  return template.includes(AMOUNT_PLACEHOLDER);
}

/**
 * 工具：把模板中的占位符替换为实际金额
 */
export function fillTemplate(template: string, amount: string): string {
  return template.split(AMOUNT_PLACEHOLDER).join(amount);
}

/**
 * 工具：返回模板中占位符的 [start, end) 区间（用于输入框自动选中）
 * 若无占位符返回 null
 */
export function findPlaceholderRange(template: string): [number, number] | null {
  const idx = template.indexOf(AMOUNT_PLACEHOLDER);
  if (idx < 0) return null;
  return [idx, idx + AMOUNT_PLACEHOLDER.length];
}
