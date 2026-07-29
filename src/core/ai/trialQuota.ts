/**
 * 试用用户每日 AI 调用配额
 *
 * 设计（卡帕西视角）：
 * - 试用用户（未配置自定义 API Key）每天可调用 AI 30 次
 * - 计数存储在 localStorage，按日期重置（自然日，非滚动 24h）
 * - 用户配置自己的 API Key 后不受此限制
 * - 这是前端配额，与 Worker 的 IP 限流（30次/分钟，防刷）互不干扰
 */

/** 每日试用 AI 调用上限 */
export const DAILY_TRIAL_LIMIT = 30;

const STORAGE_KEY = 'ai-ledger-trial-quota';

interface QuotaRecord {
  /** 日期，格式 YYYY-MM-DD，用于判断是否跨天重置 */
  date: string;
  /** 当日已调用次数 */
  count: number;
}

/** 获取当前本地日期字符串 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 读取当前配额记录，跨天自动归零 */
function readRecord(): QuotaRecord {
  const today = todayStr();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const rec = JSON.parse(raw) as QuotaRecord;
      if (rec.date === today) return rec;
    }
  } catch {
    // 损坏数据忽略，走新建
  }
  return { date: today, count: 0 };
}

/** 写入配额记录 */
function writeRecord(rec: QuotaRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // 写入失败忽略（隐私模式等）
  }
}

/** 获取今日已用次数 */
export function getTrialUsage(): number {
  return readRecord().count;
}

/** 获取今日剩余次数 */
export function getTrialRemaining(): number {
  return Math.max(0, DAILY_TRIAL_LIMIT - readRecord().count);
}

/** 判断是否还有试用额度 */
export function hasTrialQuota(): boolean {
  return readRecord().count < DAILY_TRIAL_LIMIT;
}

/** 记录一次调用（计数 +1），返回更新后的剩余次数 */
export function recordTrialUsage(): number {
  const rec = readRecord();
  rec.count += 1;
  writeRecord(rec);
  return Math.max(0, DAILY_TRIAL_LIMIT - rec.count);
}

/** 测试用：重置配额 */
export function resetTrialQuota(): void {
  writeRecord({ date: todayStr(), count: 0 });
}
