/**
 * 主解析器：整句 → 结构化意图
 * 组合 amount/date/category，识别 支出/收入/转账/还款/分期/周期记账/查询/撤销
 */
import { type AmountMatch, extractAmount } from './amount';
import { type CategoryResult, inferCategory } from './category';
import { extractDate, extractTime } from './dateParser';
import { formatDate as fmt } from './dateParser';

export interface BaseTx {
  amount: AmountMatch;
  category: string;
  subcategory?: string;
  description: string;
  date: string;
  time?: string;
  accountHint?: string;
}

export type Intent =
  | ({ kind: 'expense' } & BaseTx)
  | ({ kind: 'income' } & BaseTx)
  | {
      kind: 'transfer';
      amount: AmountMatch;
      fromHint?: string;
      toHint?: string;
      date: string;
      time?: string;
      description: string;
    }
  | {
      kind: 'repayment';
      amount: AmountMatch | null;
      targetHint?: string;
      accountHint?: string; // 用哪个账户还
      date: string;
      time?: string;
      description: string;
    }
  | {
      kind: 'installment';
      amount: AmountMatch;
      term: number;
      accountHint?: string;
      category: string;
      subcategory?: string;
      date: string;
      time?: string;
      description: string;
    }
  | {
      kind: 'recurring';
      txKind: 'expense' | 'income' | 'repayment';
      dayOfMonth: number;
      amount: AmountMatch | null;
      category: string;
      targetHint?: string;
      accountHint?: string;
      description: string;
    }
  | { kind: 'query_balance'; accountHint?: string }
  | { kind: 'query_summary'; scope: 'today' | 'month' }
  | { kind: 'analyze_trend' }
  | { kind: 'analyze_anomaly' }
  | { kind: 'undo' }
  | { kind: 'unknown'; text: string };

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseSmallCnNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s in CN_NUM) return CN_NUM[s];
  // 十一 ~ 十九
  if (s.length === 2 && s[0] === '十' && s[1] in CN_NUM) return 10 + CN_NUM[s[1]];
  // 二十 / 二十五
  if (s.length >= 2 && s[0] in CN_NUM && s[1] === '十') {
    const base = CN_NUM[s[0]] * 10;
    return s.length === 3 && s[2] in CN_NUM ? base + CN_NUM[s[2]] : base;
  }
  // 三十一
  if (s.length === 3 && s[0] in CN_NUM && s[1] === '十' && s[2] in CN_NUM) {
    return CN_NUM[s[0]] * 10 + CN_NUM[s[2]];
  }
  return null;
}

/** 常见账户别名提取 */
function extractAccountHint(text: string): string | undefined {
  const patterns = [
    /用(.{1,8}?)(?:付|支付|刷)/,
    /刷(.{1,8}?卡)/,
    /(微信|支付宝|现金|白条|花呗|[\u4e00-\u9fa5A-Za-z]{1,8}(?:储蓄卡|信用卡|借记卡|卡))/,
    /到(.{1,8}?卡)/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

function cleanDescription(text: string, ...spans: Array<{ index: number; length: number } | null>): string {
  let s = text;
  // 从后往前删，避免索引位移
  const sorted = spans.filter(Boolean).sort((a, b) => b!.index - a!.index);
  for (const sp of sorted) {
    s = s.slice(0, sp!.index) + s.slice(sp!.index + sp!.length);
  }
  return s
    .replace(/^[，,。\s]+|[，,。\s]+$/g, '')
    .replace(/^(花了|付了|用了|支出|支付)/, '')
    .trim();
}

const REPAY_TARGET = /(信用卡|花呗|白条|房贷|车贷|贷款|欠款|借款)/;

export function parse(text: string, now: Date): Intent {
  const input = text.trim();
  if (!input) return { kind: 'unknown', text };

  // 撤销
  if (/撤销|撤回|取消.{0,4}笔|删掉.{0,4}笔|删除.{0,4}笔/.test(input)) {
    return { kind: 'undo' };
  }

  // 趋势分析：含 趋势/环比/同比，或「本月比上月/去年」式比较，且无具体金额（否则按支出处理）
  const trendRe =
    /趋势|环比|同比|(?:(?:这个月|本月|近期).{0,6}(?:比|对比|相比).{0,8}(?:上个月|上月|去年|往年))|(?:(?:比|跟|和).{0,2}(?:上个月|上月|去年|往年))|(?:分析.{0,4}(?:消费|支出|账|趋势))/;
  if (trendRe.test(input) && !extractAmount(input)) {
    return { kind: 'analyze_trend' };
  }

  // 异常消费检测：异常/反常/离谱/不对劲，或「有没有异常消费」「哪笔花得离谱」，且无具体金额
  const anomalyRe =
    /异常|反常|离谱|不对劲|超常|(?:有没有|有).{0,6}(?:异常|离谱).{0,4}(?:消费|支出|花)|(?:哪笔|哪几笔).{0,10}(?:花|支出|消费).{0,6}(?:异常|离谱|不对劲)/;
  if (anomalyRe.test(input) && !extractAmount(input)) {
    return { kind: 'analyze_anomaly' };
  }

  // 查询余额
  const qBalance = /(.{0,10}?)(?:还有多少|还剩多少|余额)/.exec(input);
  if (qBalance && !/转/.test(input)) {
    const hint = extractAccountHint(qBalance[1]) ?? (qBalance[1] ? qBalance[1].trim() : undefined);
    return { kind: 'query_balance', accountHint: hint };
  }

  // 查询汇总
  const qSummary = /(这个月|本月|今天|今日).{0,6}(?:花了|支出|收入|赚|花了多少)/.exec(input);
  if (qSummary || /查.{0,4}(账|收支)/.test(input)) {
    const scope = qSummary && /今天|今日/.test(qSummary[1]) ? 'today' : 'month';
    return { kind: 'query_summary', scope };
  }

  // 周期性记账：每月X号...
  const recurRe = /每月(\d{1,2}|[一二两三四五六七八九十]{1,3})号?[，,]?(.*)/;
  const rm = recurRe.exec(input);
  if (rm) {
    const day = parseSmallCnNumber(rm[1]);
    if (day !== null && day >= 1 && day <= 31) {
      const rest = rm[2] || input;
      const amount = extractAmount(rest);
      const isRepay = REPAY_TARGET.test(rest) || /还/.test(rest);
      const isIncome = /工资|到账|收入|收租/.test(rest);
      const target = REPAY_TARGET.exec(rest)?.[1];
      const cat: CategoryResult = inferCategory(rest);
      return {
        kind: 'recurring',
        txKind: isRepay ? 'repayment' : isIncome ? 'income' : 'expense',
        dayOfMonth: day,
        amount,
        category: cat.category,
        targetHint: target,
        accountHint: extractAccountHint(rest),
        description: input,
      };
    }
  }

  // 日期 & 时间（先提取，避免 "7月15号" 的 15 被当金额）
  const dateM = extractDate(input, now);
  const timeM = extractTime(input);
  const date = dateM ? dateM.date : fmt(now);

  // 金额
  const amount = extractAmount(input);

  // 转账：从X转...到Y / 转...到Y
  const t1 = /从(.{1,10}?)转(?:了)?/.exec(input);
  const t2 = /转(?:了|账)?.{0,12}?(?:到|给)(.{1,10}?)(?:[，,。 ]|$)/.exec(input);
  if ((t1 || /转/.test(input)) && amount) {
    const toHint = t2 ? t2[1].replace(/[，,。]$/, '') : undefined;
    const fromHint = t1 ? t1[1] : undefined;
    return {
      kind: 'transfer',
      amount,
      fromHint,
      toHint,
      date,
      time: timeM?.time,
      description: cleanDescription(input, dateM, amount) || '转账',
    };
  }

  // 分期：分X期
  const instRe = /分(\d{1,2}|[一二两三四五六七八九十]{1,3})期/;
  const im = instRe.exec(input);
  if (im && amount) {
    const term = parseSmallCnNumber(im[1]);
    if (term && term >= 1 && term <= 60) {
      const cat = inferCategory(input);
      return {
        kind: 'installment',
        amount,
        term,
        accountHint: extractAccountHint(input),
        category: cat.category,
        subcategory: cat.subcategory,
        date,
        time: timeM?.time,
        description: cleanDescription(input, dateM, amount) || '分期消费',
      };
    }
  }

  // 还款：含“还”且出现还款目标关键词；或「还/还款/偿还 + 数字」（如「还500」，目标账户待追问）
  const isRepay =
    (/还/.test(input) && !/还有|还剩/.test(input) && REPAY_TARGET.test(input)) ||
    /^(?:还|还款|偿还)\s*了?\s*\d/.test(input);
  if (isRepay) {
    const target = REPAY_TARGET.exec(input)?.[1];
    return {
      kind: 'repayment',
      amount,
      targetHint: target,
      accountHint: extractAccountHint(input),
      date,
      time: timeM?.time,
      description: cleanDescription(input, dateM, amount) || `还${target ?? '欠款'}`,
    };
  }

  // 收入
  if (/到账|收入|工资|奖金|报销|赚了|收了|进账|发工资|退款|利息/.test(input)) {
    if (amount) {
      const cat = inferCategory(input);
      return {
        kind: 'income',
        amount,
        category: cat.category,
        subcategory: cat.subcategory,
        description: cleanDescription(input, dateM, amount) || input,
        date,
        time: timeM?.time,
        accountHint: extractAccountHint(input),
      };
    }
  }

  // 支出（默认）
  if (amount) {
    const cat = inferCategory(input);
    return {
      kind: 'expense',
      amount,
      category: cat.category,
      subcategory: cat.subcategory,
      description: cleanDescription(input, dateM, amount) || input,
      date,
      time: timeM?.time,
      accountHint: extractAccountHint(input),
    };
  }

  return { kind: 'unknown', text: input };
}
