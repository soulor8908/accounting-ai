/**
 * 用户行为习惯启发式提取
 *
 * 设计原则（卡帕西视角）：
 * - 纯客户端规则匹配，零额外 token 开销
 * - 每次最多产出 1 条最显著的记忆，避免噪音堆积
 * - 调用方负责去重（memoryStore.hasSimilar），本模块只负责"观察到什么"
 *
 * 乔布斯视角：记忆要像用户身边的贴心助手——只在真正学到东西时开口，
 * 不把每次输入都变成记忆垃圾。
 */
import type { MemoryCategory } from '../store/memory';

export interface HabitObservation {
  content: string;
  category: MemoryCategory;
}

interface Rule {
  pattern: RegExp;
  build: (m: RegExpMatchArray, ctx: HabitContext) => HabitObservation;
}

interface HabitContext {
  /** 当前小时（0-23），用于时段判断 */
  hour: number;
}

/** 规则表：按优先级从高到低匹配，命中即返回 */
const RULES: Rule[] = [
  // 账户偏好（最强信号，用户主动点名账户）
  { pattern: /(支付宝|余额宝)/, build: () => ({ content: '使用支付宝', category: 'preference' }) },
  { pattern: /(花呗|白条)/, build: () => ({ content: '使用花呗/白条等信用分期', category: 'preference' }) },
  { pattern: /(微信零钱|微信|零钱)/, build: () => ({ content: '偏好使用微信零钱支付', category: 'preference' }) },
  { pattern: /(信用卡|招行|工行|建行|中行|农行|交行)/, build: (m) => ({ content: `常用信用卡：${m[1]}`, category: 'preference' }) },
  // 消费类型习惯
  { pattern: /(打车|滴滴|出租车|地铁|公交|高铁|火车|飞机)/, build: (m) => ({ content: `有交通出行消费：${m[1]}`, category: 'habit' }) },
  { pattern: /(早饭|早餐|午饭|午餐|中午|晚饭|晚餐|宵夜|外卖|吃了|吃顿|碗面|汤面)/, build: (m) => ({ content: `有餐饮消费：${m[1]}`, category: 'habit' }) },
  { pattern: /(工资|薪水)/, build: () => ({ content: '有工资收入入账', category: 'fact' }) },
  { pattern: /(房租|水电|物业)/, build: (m) => ({ content: `有固定生活支出：${m[1]}`, category: 'habit' }) },
  // 大额消费：4 位及以上数字 + 块/元
  {
    pattern: /(\d{1,3}(?:,\d{3})+|\d{4,})\s*[块元]/,
    build: (m) => {
      const num = Number(m[1].replace(/,/g, ''));
      if (num >= 1000) return { content: '存在大额消费记录', category: 'habit' };
      return { content: '有日常小额消费', category: 'habit' };
    },
  },
];

/**
 * 从用户消息中提取行为习惯观察
 * @param userMessage 用户本轮输入
 * @returns 观察到的习惯，或 null（无显著信号）
 */
export function extractHabit(userMessage: string): HabitObservation | null {
  const text = userMessage.trim();
  if (!text) return null;
  const ctx: HabitContext = { hour: new Date().getHours() };
  for (const rule of RULES) {
    const m = text.match(rule.pattern);
    if (m) return rule.build(m, ctx);
  }
  return null;
}
