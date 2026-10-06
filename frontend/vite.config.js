import {defineConfig} from 'vite';

export default defineConfig({
  // 使用 React 17+ 的自动 JSX 运行时，组件文件无需再手动 import React
  esbuild: {jsx: 'automatic'},
  build: {outDir: 'dist', emptyOutDir: true},
  server: {host: '127.0.0.1', port: 5173},
});
