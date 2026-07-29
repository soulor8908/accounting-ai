/** 自然语言日期解析：相对日期（昨天/上周三）与绝对日期（7月15号） */

export interface DateMatch {
  date: string; // YYYY-MM-DD
  raw: string;
  index: number;
  length: number;
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** ISO 周几：周一=1 ... 周日=7 */
function isoWeekday(d: Date): number {
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

const RELATIVE_DAYS: Record<string, number> = {
  大前天: -3,
  前天: -2,
  昨天: -1,
  昨晚: -1,
  昨日: -1,
  今天: 0,
  今日: 0,
  明天: 1,
  明日: 1,
};

/**
 * 从文本中提取日期。返回 null 表示未提及（调用方默认今天）。
 */
export function extractDate(text: string, now: Date): DateMatch | null {
  // 1. 相对日词（先匹配长词：大前天 > 前天）
  for (const word of Object.keys(RELATIVE_DAYS)) {
    const idx = text.indexOf(word);
    if (idx >= 0) {
      return {
        date: formatDate(addDays(now, RELATIVE_DAYS[word])),
        raw: word,
        index: idx,
        length: word.length,
      };
    }
  }

  // 2. 周X：上周/这/本周/下周/裸周X
  const weekRe = /(上上|上|这|本|下)?(?:周|星期)([一二三四五六日天])/;
  const wm = weekRe.exec(text);
  if (wm) {
    const prefix = wm[1] ?? '';
    const target = WEEKDAY_MAP[wm[2]];
    const monday = addDays(now, -(isoWeekday(now) - 1));
    let offset = target - 1;
    if (prefix === '上') offset -= 7;
    else if (prefix === '上上') offset -= 14;
    else if (prefix === '下') offset += 7;
    else if (prefix === '' || prefix === '这' || prefix === '本') {
      // 裸周X：若本周尚未到，则取上周
      if (prefix === '' && offset > isoWeekday(now) - 1) offset -= 7;
    }
    return {
      date: formatDate(addDays(monday, offset)),
      raw: wm[0],
      index: wm.index,
      length: wm[0].length,
    };
  }

  // 3. 2026年7月15日 / 2026-07-15 / 2026/7/5
  const fullRe = /(\d{4})\s*[年\-/]\s*(\d{1,2})\s*[月\-/]\s*(\d{1,2})\s*[日号]?/;
  const fm = fullRe.exec(text);
  if (fm) {
    const d = new Date(Number(fm[1]), Number(fm[2]) - 1, Number(fm[3]));
    return { date: formatDate(d), raw: fm[0], index: fm.index, length: fm[0].length };
  }

  // 4. 7月15号 / 7月15日（取当前年）
  const mdRe = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/;
  const mm = mdRe.exec(text);
  if (mm) {
    const d = new Date(now.getFullYear(), Number(mm[1]) - 1, Number(mm[2]));
    return { date: formatDate(d), raw: mm[0], index: mm.index, length: mm[0].length };
  }

  return null;
}

/** 从文本中提取时间：8点 / 20:30 / 八点半 / 早上8点 */
export function extractTime(text: string): { time: string; raw: string } | null {
  // HH:mm 或 HH:mm:ss
  const hm = /(\d{1,2})[:：](\d{2})/.exec(text);
  if (hm) {
    const h = Number(hm[1]);
    if (h >= 0 && h < 24) {
      return { time: `${String(h).padStart(2, '0')}:${hm[2]}`, raw: hm[0] };
    }
  }
  // X点半 / X点
  const cnNum: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const dianRe = /(早上|上午|中午|下午|晚上|凌晨)?(\d{1,2}|[一二两三四五六七八九十]{1,2})点(半)?/;
  const dm = dianRe.exec(text);
  if (dm) {
    let h: number;
    if (/^\d+$/.test(dm[2])) h = Number(dm[2]);
    else if (dm[2] === '十') h = 10;
    else if (dm[2].length === 2 && dm[2][0] === '十') h = 10 + (cnNum[dm[2][1]] ?? 0);
    else h = cnNum[dm[2]] ?? NaN;
    if (Number.isNaN(h) || h > 24) return null;
    const period = dm[1] ?? '';
    if ((period === '下午' || period === '晚上') && h < 12) h += 12;
    if (period === '中午' && h < 12) h = 12;
    const minute = dm[3] ? 30 : 0;
    return { time: `${String(h % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, raw: dm[0] };
  }
  return null;
}
