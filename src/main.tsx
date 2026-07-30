import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadRuntimeConfig } from './core/config/runtime';
import './styles.css';

// 部署期配置：拉取 /app.config.json（若存在），用于覆盖代理地址、默认模型、配额、应用名，无需重新构建
loadRuntimeConfig().then((cfg) => {
  if (cfg.appName) document.title = cfg.appName;
});

// P2 PWA：仅生产环境注册 Service Worker（开发环境跳过，避免缓存干扰 HMR）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败不影响主流程 */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
