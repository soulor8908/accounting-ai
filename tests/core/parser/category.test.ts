import { describe, expect, it } from 'vitest';
import { inferCategory } from '../../../src/core/parser/category';

describe('inferCategory - 餐饮', () => {
  it.each([
    ['中午吃了碗面', '餐饮', '午餐'],
    ['吃了顿早餐', '餐饮', '早餐'],
    ['午餐叫了个外卖', '餐饮', '午餐'],
    ['晚上聚餐', '餐饮', '晚餐'],
    ['买了杯咖啡', '餐饮', '咖啡茶饮'],
    ['点了杯奶茶', '餐饮', '咖啡茶饮'],
    ['超市买了点水果', '餐饮', '水果零食'],
  ])('%s → %s/%s', (input, cat, sub) => {
    const r = inferCategory(input);
    expect(r.category).toBe(cat);
    expect(r.subcategory).toBe(sub);
  });
});

describe('inferCategory - 其他分类', () => {
  it.each([
    ['打车去公司', '交通'],
    ['地铁充值', '交通'],
    ['给车加了油', '交通'],
    ['交这个月房租', '住房'],
    ['交了电费', '住房'],
    ['淘宝买了件衣服', '购物'],
    ['买了部手机', '购物'],
    ['看了场电影', '娱乐'],
    ['充值游戏', '娱乐'],
    ['去医院看病', '医疗'],
    ['买了盒感冒药', '医疗'],
    ['报了个英语课', '教育'],
    ['买了本书', '教育'],
    ['充了话费', '通讯'],
    ['随便记一笔', '日常'],
  ])('%s → %s', (input, cat) => {
    expect(inferCategory(input).category).toBe(cat);
  });
});

describe('inferCategory - 收入类', () => {
  it.each([
    ['工资到账', '工资'],
    ['发了年终奖', '奖金'],
    ['报销下来了', '报销'],
    ['收了个红包', '红包'],
    ['理财利息到账', '理财收益'],
  ])('%s → %s', (input, cat) => {
    expect(inferCategory(input).category).toBe(cat);
  });
});
