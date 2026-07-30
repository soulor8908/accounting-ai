/**
 * i18n 运行时（P2 i18n）
 * - 当前语言持久化到 localStorage（key 'ai-ledger-lang'），默认中文
 * - t(key, vars?) 取当前语言字典；缺失 key 原样返回
 * - onLangChange 供 React hook 订阅语言切换，切换时全量重渲染
 */
import { dictFor, type Lang } from './dict';
export type { Lang };

const STORAGE_KEY = 'ai-ledger-lang';
const listeners = new Set<() => void>();

function readInitial(): Lang {
  if (typeof localStorage === 'undefined') return 'zh';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'en' ? 'en' : 'zh';
}

let current: Lang = readInitial();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* 隐私模式忽略 */
  }
  listeners.forEach((cb) => cb());
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = dictFor(current);
  let s = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

export function onLangChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
