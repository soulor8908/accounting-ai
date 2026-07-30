/**
 * 部署期运行时配置（P1-3 部署参数化）
 *
 * 目标：不同部署环境（自有域名、私有化、演示站）无需重新构建即可调整：
 *   - 试用代理 Worker 地址（trialProxyUrl）
 *   - 内置试用模型（defaultModel）
 *   - 每日试用配额（dailyTrialLimit）
 *   - 应用显示名（appName）
 *
 * 取值优先级：
 *   1. 部署时放置的 `/app.config.json`（运行时拉取，无需重建）
 *   2. 构建期注入的 VITE_* 环境变量（内联进 bundle）
 *
 * 加载：在应用启动处调用一次 loadRuntimeConfig()（main.tsx 已调用），
 * 之后所有读取走 getRuntimeConfig()，自动拿到最新值。
 */
export interface RuntimeConfig {
  trialProxyUrl?: string;
  defaultModel?: string;
  dailyTrialLimit?: number;
  appName?: string;
}

function readBuildTime(): RuntimeConfig {
  return {
    trialProxyUrl: import.meta.env.VITE_TRIAL_PROXY_URL || undefined,
    defaultModel: import.meta.env.VITE_DEFAULT_MODEL || undefined,
    dailyTrialLimit: import.meta.env.VITE_DAILY_TRIAL_LIMIT
      ? Number(import.meta.env.VITE_DAILY_TRIAL_LIMIT)
      : undefined,
    appName: import.meta.env.VITE_APP_NAME || undefined,
  };
}

let cache: RuntimeConfig = readBuildTime();
let loaded = false;

/** 同步读取当前配置（loadRuntimeConfig 之后才包含 app.config.json 的覆盖） */
export function getRuntimeConfig(): RuntimeConfig {
  return cache;
}

/**
 * 拉取部署期 /app.config.json 并合并到配置。
 * 文件不存在或被 CSP/网络拦截时静默降级为仅构建期注入值。
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (loaded) return cache;
  loaded = true;
  try {
    const res = await fetch('/app.config.json', { cache: 'no-cache' });
    if (res.ok) {
      const json = (await res.json()) as Partial<RuntimeConfig>;
      cache = {
        trialProxyUrl: json.trialProxyUrl ?? cache.trialProxyUrl,
        defaultModel: json.defaultModel ?? cache.defaultModel,
        dailyTrialLimit: json.dailyTrialLimit ?? cache.dailyTrialLimit,
        appName: json.appName ?? cache.appName,
      };
    }
  } catch {
    // 无 app.config.json：保持构建期注入值
  }
  return cache;
}
