import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // 现代浏览器目标：es2020 起步，去掉 ES5 兼容代码，缩小产物体积
    target: 'es2020',
    // CSS 压缩（默认 esbuild，保持开启）
    cssMinify: 'esbuild',
    // 体积超过 100KB 才提示，避免 chunk 拆分后误报
    chunkSizeWarningLimit: 100,
    rollupOptions: {
      output: {
        // 拆分 vendor：react/react-dom 单独成 chunk，长期缓存
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
