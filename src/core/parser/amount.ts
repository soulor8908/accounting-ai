/**
 * 口语化金额解析
 * 支持：阿拉伯数字、k/w/万 缩写、中文数字（含块/毛/分）、模糊金额（estimated 标记）
 */
import { round2 } from '../utils/money';

export interface AmountMatch {
  value: number;
  estimated: boolean;
  raw: string;
  index: number;
  length: number;
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_SMALL_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const CN_BIG_UNITS: Record<string, number> = { 万: 1e4, 亿: 1e8 };

const CN_NUM_CLASS = '零一二两三四五六七八九十百千万亿';

function isCnDigit(ch: string): boolean {
  return ch in CN_DIGITS;
}

/** 解析"块/元"后的小数部分：五 / 五毛 / 五毛二 / 零八分 / 5 */
function parseFraction(rest: string): number {
  if (!rest) return 0;
  // 纯"分"（无 毛/角）："八分" → 0.08，"零八分" → 0.08
  if (rest.includes('分') && !/[毛角]/.test(rest)) {
    const digitsPart = rest.slice(0, rest.indexOf('分'));
    let digits = '';
    for (const ch of digitsPart) {
      if (isCnDigit(ch)) digits += String(CN_DIGITS[ch]);
      else if (/^\d$/.test(ch)) digits += ch;
    }
    if (!digits) return 0;
    return round2(Number(digits) / 100);
  }
  const chars = [...rest];
  let i = 0;
  const readDigit = (): number | null => {
    if (i >= chars.length) return null;
    const ch = chars[i];
    if (isCnDigit(ch)) { i++; return CN_DIGITS[ch]; }
    if (/^\d$/.test(ch)) { i++; return Number(ch); }
    return null;
  };
  const skipUnit = (units: string[]): boolean => {
    if (i < chars.length && units.includes(chars[i])) { i++; return true; }
    return false;
  };

  let tenths: number | null = null;
  let hundredths: number | null = null;

  const first = readDigit();
  if (first === null) return 0;
  if (first === 0 && chars[i - 1] === '零') {
    // 零八 → 0.08
    hundredths = readDigit();
  } else {
    tenths = first;
    skipUnit(['毛', '角']);
    const second = readDigit();
    if (second !== null) hundredths = second;
  }
  return round2((tenths ?? 0) / 10 + (hundredths ?? 0) / 100);
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'small'; v: number }
  | { t: 'big'; v: number };

/** 解析整数部分：纯中文 / 纯阿拉伯 / 混合（如 3万5） */
function parseCnInteger(main: string): number | null {
  if (!main) return null;
  const tokens: Token[] = [];
  let i = 0;
  const chars = [...main];
  while (i < chars.length) {
    const ch = chars[i];
    if (/^\d$/.test(ch) || ch === '.') {
      let j = i;
      let numStr = '';
      while (j < chars.length && (/^\d$/.test(chars[j]) || chars[j] === '.')) {
        numStr += chars[j];
        j++;
      }
      const v = Number(numStr);
      if (Number.isNaN(v)) return null;
      tokens.push({ t: 'num', v });
      i = j;
    } else if (isCnDigit(ch)) {
      tokens.push({ t: 'num', v: CN_DIGITS[ch] });
      i++;
    } else if (ch in CN_SMALL_UNITS) {
      tokens.push({ t: 'small', v: CN_SMALL_UNITS[ch] });
      i++;
    } else if (ch in CN_BIG_UNITS) {
      tokens.push({ t: 'big', v: CN_BIG_UNITS[ch] });
      i++;
    } else {
      return null; // 含无法识别的字符
    }
  }
  if (tokens.length === 0) return null;

  let total = 0;
  let section = 0;
  let pending: number | null = null;
  let lastSmall = 0;
  let lastBig = 0;
  let zeroSeen = false;
  let pendingIsZero = false;

  for (const tk of tokens) {
    if (tk.t === 'num') {
      pendingIsZero = tk.v === 0;
      if (tk.v === 0) zeroSeen = true;
      pending = tk.v;
    } else if (tk.t === 'small') {
      const v = pending ?? 1;
      section += v * tk.v;
      lastSmall = tk.v;
      pending = null;
      zeroSeen = false;
      pendingIsZero = false;
    } else {
      // big unit
      if (pending !== null) {
        section += pending;
        pending = null;
      }
      if (tk.v === 1e8) {
        total = (total + section) * 1e8;
      } else {
        total += section * tk.v;
      }
      section = 0;
      lastBig = tk.v;
      lastSmall = 0;
      zeroSeen = false;
      pendingIsZero = false;
    }
  }
  // 结尾挂着的数字：按上一单位降一位（两千五 → 500；一万二千三百四十五 → 5）
  if (pending !== null) {
    if (pendingIsZero) {
      // 末尾是"零"，忽略
    } else if (zeroSeen) {
      section += pending; // 一千零五 → +5
    } else if (lastSmall > 0) {
      section += pending * (lastSmall / 10);
    } else if (lastBig > 0) {
      section += pending * (lastBig / 10);
    } else {
      section += pending;
    }
  }
  return round2(total + section);
}

/**
 * 解析中文/混合数字金额。
 * 支持：二十五 / 两千五 / 一万二千三百四十五 / 3万5 / 3.5万 / 三十五块五 / 三块五毛二
 */
export function parseChineseNumber(input: string): number | null {
  if (!input || !input.trim()) return null;
  const s = input.trim();

  let frac = 0;
  let main = s;
  const kuaiMatch = s.match(/[块元]/);
  if (kuaiMatch && kuaiMatch.index !== undefined) {
    main = s.slice(0, kuaiMatch.index);
    frac = parseFraction(s.slice(kuaiMatch.index + 1));
    if (!main) return frac > 0 ? frac : null; // "块五" 不合法，main 为空但有 块
  }
  const intVal = parseCnInteger(main);
  if (intVal === null) {
    // 无 块/元 但含 毛/角/分：整体作为小数（"六毛" → 0.6）
    if (!kuaiMatch && /[毛角分]/.test(s)) {
      const f = parseFraction(s);
      return f > 0 ? f : null;
    }
    return null;
  }
  return round2(intVal + frac);
}

interface Candidate {
  regex: RegExp;
  estimated: boolean;
  /** 'wan' = 走 parseChineseNumber（支持 3万5 / 3万5千）；'k' = 数字×1000 */
  mode?: 'wan' | 'k';
}

const FUZZY_SUFFIX = '(?:来块(?:钱)?|来|多块(?:钱)?|多|把块|把|左右|上下)';

function makeCandidates(): Candidate[] {
  const cnDec = CN_NUM_CLASS.replace(/[十百千万亿]/g, '');
  return [
    // 模糊：前缀带模糊词 → estimated
    {
      regex: new RegExp(`(?:大约|大概|约莫?|近|接近|小|差不多)\\s*(\\d+(?:\\.\\d+)?[kKwW万]|[${CN_NUM_CLASS}]+(?:[块元][${cnDec}\\d]*[毛角分]?[${cnDec}\\d]*分?)?)\\s*(?:来块(?:钱)?|来|把块|把|左右|上下)?`),
      estimated: true,
    },
    // 模糊：数字 + 多/来/把 后缀
    {
      regex: new RegExp(`(\\d+(?:\\.\\d+)?|[${CN_NUM_CLASS}]+)\\s*(?:来块(?:钱)?|多块(?:钱)?|多|把块|来)`),
      estimated: true,
    },
    // 阿拉伯 + k
    { regex: /\d+(?:\.\d+)?[kK]/, estimated: false, mode: 'k' },
    // 阿拉伯 + w/万（可接中文数字续段，如 3万5 / 3万5千）
    { regex: new RegExp(`\\d+(?:\\.\\d+)?[wW万][${CN_NUM_CLASS}\\d]*`), estimated: false, mode: 'wan' },
    // 中文数字带 块/元
    {
      regex: new RegExp(`[${CN_NUM_CLASS}]+[块元][${cnDec}\\d]*(?:[毛角][${cnDec}\\d]*分?)?`),
      estimated: false,
    },
    // 纯中文数字（至少2字，避免误伤）
    { regex: new RegExp(`[${CN_NUM_CLASS}]{2,}`), estimated: false },
    // 纯阿拉伯数字（后面会过滤期/月/日等干扰）
    { regex: /\d+(?:\.\d+)?/, estimated: false },
  ];
}

/** 数字后紧跟这些字时不视为金额 */
const EXCLUDE_AFTER = ['期', '月', '日', '号', '年', '点', '折', '层', '楼', '公里', '岁', '天', '个', '张', '笔', '次'];

function isExcludedContext(text: string, endIndex: number): boolean {
  const after = text.slice(endIndex, endIndex + 2);
  return EXCLUDE_AFTER.some((w) => after.startsWith(w));
}

/**
 * 从整句中提取第一个金额。
 * 调用方应先剔除日期/时间片段，避免 "7月15号" 被当作金额。
 */
export function extractAmount(text: string): AmountMatch | null {
  for (const cand of makeCandidates()) {
    const regex = new RegExp(cand.regex.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      let raw = m[0];
      // 模糊前缀词不属于数字本身，parse 前保留无妨（parseChineseNumber 会失败），先剥离非数字前缀
      raw = raw.replace(/^(大约|大概|约莫?|近|接近|小|差不多)\s*/, '');
      const endIndex = m.index + m[0].length;
      if (isExcludedContext(text, endIndex)) continue;

      let value: number | null;
      if (cand.mode === 'k') {
        value = Number(raw.replace(/[kK]/, '')) * 1000;
      } else if (cand.mode === 'wan') {
        value = parseChineseNumber(raw.replace(/[wW]/g, '万'));
      } else if (/^\d+(?:\.\d+)?$/.test(raw)) {
        value = Number(raw);
      } else {
        // 剥离模糊后缀
        const cleaned = raw.replace(new RegExp(`${FUZZY_SUFFIX}$`), '');
        value = parseChineseNumber(cleaned);
      }
      if (value === null || Number.isNaN(value) || value <= 0) continue;
      // 后缀为"多/来/左右/上下"时也视为估算
      const estimated =
        cand.estimated || new RegExp(`${FUZZY_SUFFIX}$`).test(m[0]);
      return { value: round2(value), estimated, raw: m[0], index: m.index, length: m[0].length };
    }
  }
  return null;
}
