/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 试用 AI 代理 Worker URL（构建时注入，前端不持有 API Key） */
  readonly VITE_TRIAL_PROXY_URL?: string;
  /** 内置试用默认模型（可被部署期 /app.config.json 覆盖） */
  readonly VITE_DEFAULT_MODEL?: string;
  /** 每日试用配额上限 */
  readonly VITE_DAILY_TRIAL_LIMIT?: string;
  /** 应用显示名（写入 document.title） */
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
