import { describe, expect, it } from 'vitest';
import { extractHabit } from '../../../src/core/ai/habits';

describe('extractHabit', () => {
  it('识别微信零钱偏好', () => {
    const r = extractHabit('微信还有多少余额');
    expect(r).not.toBeNull();
    expect(r!.category).toBe('preference');
    expect(r!.content).toContain('微信');
  });

  it('识别支付宝偏好', () => {
    const r = extractHabit('从支付宝转200到微信');
    expect(r).not.toBeNull();
    expect(r!.content).toContain('支付宝');
  });

  it('识别餐饮消费习惯', () => {
    const r = extractHabit('中午吃了碗面25');
    expect(r).not.toBeNull();
    expect(r!.category).toBe('habit');
  });

  it('识别交通出行消费', () => {
    const r = extractHabit('打车30');
    expect(r).not.toBeNull();
    expect(r!.content).toContain('交通');
  });

  it('识别工资收入事实', () => {
    const r = extractHabit('3k工资到账');
    expect(r).not.toBeNull();
    expect(r!.category).toBe('fact');
    expect(r!.content).toContain('工资');
  });

  it('识别大额消费', () => {
    const r = extractHabit('买了台电脑 8000块');
    expect(r).not.toBeNull();
    expect(r!.content).toContain('大额');
  });

  it('无显著信号返回 null', () => {
    expect(extractHabit('你好')).toBeNull();
    expect(extractHabit('')).toBeNull();
    expect(extractHabit('   ')).toBeNull();
  });

  it('信用卡偏好匹配', () => {
    const r = extractHabit('招行信用卡还了1000');
    expect(r).not.toBeNull();
    expect(r!.content).toContain('信用卡');
  });

  it('固定生活支出识别', () => {
    const r = extractHabit('交房租3000');
    expect(r).not.toBeNull();
    expect(r!.content).toContain('房租');
  });
});
