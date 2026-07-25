import { describe, expect, it } from 'vitest';
import { extractAmount, parseChineseNumber } from '../../../src/core/parser/amount';

describe('parseChineseNumber - 基础数字', () => {
  it.each([
    ['二十五', 25],
    ['十', 10],
    ['一百', 100],
    ['一百零五', 105],
    ['两百', 200],
    ['两千五', 2500],
    ['一千二', 1200],
    ['三千', 3000],
    ['一万', 10000],
    ['一万二千三百四十五', 12345],
    ['三万五', 35000],
    ['十万', 100000],
    ['一百二十三万四千五百六十七', 1234567],
  ])('%s → %d', (input, expected) => {
    expect(parseChineseNumber(input)).toBe(expected);
  });
});

describe('parseChineseNumber - 小数（块/毛/分）', () => {
  it.each([
    ['三十五块五', 35.5],
    ['三十五块五毛', 35.5],
    ['三块五毛二', 3.52],
    ['十块零八分', 10.08],
    ['五块', 5],
    ['六毛', 0.6],
    ['八块九', 8.9],
  ])('%s → %d', (input, expected) => {
    expect(parseChineseNumber(input)).toBeCloseTo(expected, 2);
  });
});

describe('parseChineseNumber - 非法输入', () => {
  it('无法解析时返回 null', () => {
    expect(parseChineseNumber('吃饭')).toBeNull();
    expect(parseChineseNumber('')).toBeNull();
  });
});

describe('extractAmount - 阿拉伯数字', () => {
  it.each([
    ['中午吃了碗面25', 25, false],
    ['花了35.50元', 35.5, false],
    ['工资到账 8000', 8000, false],
  ])('%s → %d', (input, expected, estimated) => {
    const m = extractAmount(input);
    expect(m).not.toBeNull();
    expect(m!.value).toBe(expected);
    expect(m!.estimated).toBe(estimated);
  });
});

describe('extractAmount - k/万 缩写', () => {
  it.each([
    ['3k工资到账', 3000],
    ['转了2K', 2000],
    ['3.5k', 3500],
    ['3万5到手', 35000],
    ['3.5万存款', 35000],
    ['花了2w', 20000],
  ])('%s → %d', (input, expected) => {
    const m = extractAmount(input);
    expect(m).not.toBeNull();
    expect(m!.value).toBe(expected);
    expect(m!.estimated).toBe(false);
  });
});

describe('extractAmount - 中文数字', () => {
  it.each([
    ['从招行卡转了两千五到微信', 2500],
    ['中午吃了三十五块五', 35.5],
    ['还了一万二千三百四十五', 12345],
    ['打车二十五', 25],
  ])('%s → %d', (input, expected) => {
    const m = extractAmount(input);
    expect(m).not.toBeNull();
    expect(m!.value).toBe(expected);
  });
});

describe('extractAmount - 模糊金额标记 estimated', () => {
  it.each([
    ['昨晚请同事吃饭花了三百多', 300],
    ['两百来块买了个杯子', 200],
    ['花了小一千', 1000],
    ['打车大概五十左右', 50],
    ['花了千把块', 1000],
  ])('%s → %d (estimated)', (input, expected) => {
    const m = extractAmount(input);
    expect(m).not.toBeNull();
    expect(m!.value).toBe(expected);
    expect(m!.estimated).toBe(true);
  });
});

describe('extractAmount - 排除干扰', () => {
  it('不匹配期数', () => {
    const m = extractAmount('分12期买了手机5000');
    expect(m).not.toBeNull();
    expect(m!.value).toBe(5000);
  });

  it('无金额返回 null', () => {
    expect(extractAmount('还了信用卡一部分')).toBeNull();
  });
});
