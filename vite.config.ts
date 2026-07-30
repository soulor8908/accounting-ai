import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

// 分析模式：ANALYZE=1 时生成打包体积可视化报告（dist/stats.html）+ JSON（供体积监控）
const analyze = process.env.ANALYZE === '1';

export default defineConfig({
  plugins: [
    react(),
    analyze &&
      visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: false,
        // 仅分析模式生成，不阻塞普通构建
      }),
  ],
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
