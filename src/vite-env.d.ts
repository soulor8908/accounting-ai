/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 试用 AI 代理 Worker URL（构建时注入，前端不持有 API Key） */
  readonly VITE_TRIAL_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
