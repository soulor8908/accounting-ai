/** 分类推断：关键词 → 类别/子类别 */

export interface CategoryResult {
  category: string;
  subcategory?: string;
}

interface Rule {
  keywords: string[];
  category: string;
  subcategory?: string;
}

// 顺序即优先级：先匹配先生效
const RULES: Rule[] = [
  // 餐饮子类（更具体的关键词放前面）
  { keywords: ['早餐', '早饭', '早点'], category: '餐饮', subcategory: '早餐' },
  { keywords: ['午餐', '午饭', '中饭', '中午吃'], category: '餐饮', subcategory: '午餐' },
  { keywords: ['晚餐', '晚饭', '夜宵', '聚餐', '晚上吃'], category: '餐饮', subcategory: '晚餐' },
  { keywords: ['咖啡', '奶茶', '茶', '饮料', '果汁'], category: '餐饮', subcategory: '咖啡茶饮' },
  { keywords: ['水果', '零食', '超市', '买菜', '菜'], category: '餐饮', subcategory: '水果零食' },
  { keywords: ['吃', '饭', '外卖', '火锅', '烧烤', '面', '包子', '肯德基', '麦当劳'], category: '餐饮' },
  // 交通
  { keywords: ['打车', '滴滴', '出租车', '网约车'], category: '交通', subcategory: '打车' },
  { keywords: ['地铁', '公交', '乘车'], category: '交通', subcategory: '公共交通' },
  { keywords: ['加油', '油费', '加了油'], category: '交通', subcategory: '加油' },
  { keywords: ['停车'], category: '交通', subcategory: '停车费' },
  { keywords: ['高铁', '火车', '机票', '飞机', '车票'], category: '交通', subcategory: '长途出行' },
  { keywords: ['过路费', '高速费', 'ETC'], category: '交通' },
  // 住房
  { keywords: ['房租', '租金', '房贷'], category: '住房', subcategory: '房租月供' },
  { keywords: ['电费', '水费', '燃气', '水电', '物业'], category: '住房', subcategory: '水电物业' },
  // 医疗（优先于泛化"买"）
  { keywords: ['医院', '看病', '药', '体检', '门诊'], category: '医疗' },
  // 教育（优先于泛化"买"）
  { keywords: ['书', '课程', '培训', '学费', '考试', '课'], category: '教育' },
  // 通讯
  { keywords: ['话费', '流量', '宽带'], category: '通讯' },
  // 娱乐
  { keywords: ['电影', '游戏', 'KTV', '旅游', '门票', '会员', '演唱会', '视频'], category: '娱乐' },
  // 购物
  { keywords: ['淘宝', '京东', '拼多多', '网购'], category: '购物', subcategory: '网购' },
  { keywords: ['衣服', '鞋', '裤', '裙'], category: '购物', subcategory: '服饰' },
  { keywords: ['手机', '电脑', '数码', '耳机', '平板'], category: '购物', subcategory: '数码' },
  // 收入类
  { keywords: ['工资', '薪资', '薪水'], category: '工资' },
  { keywords: ['年终奖', '奖金', '绩效'], category: '奖金' },
  { keywords: ['报销'], category: '报销' },
  { keywords: ['红包'], category: '红包' },
  { keywords: ['利息', '理财', '收益', '分红'], category: '理财收益' },
  { keywords: ['退款', '退了'], category: '退款' },
  // 泛化"买/购"放最后，避免抢占医疗/教育等具体分类
  { keywords: ['买', '购'], category: '购物' },
];

export function inferCategory(text: string): CategoryResult {
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        const r: CategoryResult = { category: rule.category };
        if (rule.subcategory) r.subcategory = rule.subcategory;
        return r;
      }
    }
  }
  return { category: '日常' };
}

export const EXPENSE_CATEGORIES = ['餐饮', '交通', '住房', '购物', '娱乐', '医疗', '教育', '通讯', '日常'];
export const INCOME_CATEGORIES = ['工资', '奖金', '报销', '红包', '理财收益', '退款', '其他收入'];
