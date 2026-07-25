import { describe, expect, it } from 'vitest';
import { extractDate, formatDate } from '../../../src/core/parser/dateParser';

// 2026-07-24 是周五
const NOW = new Date(2026, 6, 24, 15, 30);

describe('formatDate', () => {
  it('格式化为 YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('extractDate - 相对日期', () => {
  it.each([
    ['今天吃午饭', '2026-07-24'],
    ['昨天打车', '2026-07-23'],
    ['昨晚请同事吃饭', '2026-07-23'],
    ['前天买的书', '2026-07-22'],
    ['大前天加油', '2026-07-21'],
    ['明天要还信用卡', '2026-07-25'],
  ])('%s → %s', (input, expected) => {
    const m = extractDate(input, NOW);
    expect(m).not.toBeNull();
    expect(m!.date).toBe(expected);
  });
});

describe('extractDate - 周X', () => {
  it.each([
    ['上周五吃饭', '2026-07-17'],
    ['上周三加油', '2026-07-15'],
    ['上周日爬山', '2026-07-19'],
    ['本周三打车', '2026-07-22'],
    ['这周一买菜', '2026-07-20'],
    ['周三打车', '2026-07-22'],
    ['周五吃饭', '2026-07-24'],
    ['下周三还花呗', '2026-07-29'],
  ])('%s → %s', (input, expected) => {
    const m = extractDate(input, NOW);
    expect(m).not.toBeNull();
    expect(m!.date).toBe(expected);
  });

  it('裸周X若在未来则取上周（周六→7月18）', () => {
    const m = extractDate('周六逛街', NOW);
    expect(m!.date).toBe('2026-07-18');
  });
});

describe('extractDate - 绝对日期', () => {
  it.each([
    ['7月15号发工资', '2026-07-15'],
    ['7月15日', '2026-07-15'],
    ['2026年7月5日', '2026-07-05'],
    ['2026-07-15 转账', '2026-07-15'],
    ['2026/7/5 消费', '2026-07-05'],
    ['12月31号跨年', '2026-12-31'],
  ])('%s → %s', (input, expected) => {
    const m = extractDate(input, NOW);
    expect(m).not.toBeNull();
    expect(m!.date).toBe(expected);
  });
});

describe('extractDate - 无日期', () => {
  it('返回 null，由调用方默认今天', () => {
    expect(extractDate('中午吃了碗面25', NOW)).toBeNull();
  });
});

describe('extractDate - 非法日期兜底', () => {
  it('2月30号 → 顺延为3月2日（Date 规范化）', () => {
    const m = extractDate('2月30号', NOW);
    expect(m).not.toBeNull();
    expect(m!.date).toBe('2026-03-02');
  });
});
