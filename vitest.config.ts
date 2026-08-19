import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Taro 运行时在 dom-external 等模块里引用了若干编译期常量（ENABLE_INNER_HTML 等），
  // 这些常量本应由 Taro webpack 插件通过 DefinePlugin 注入。vitest 直接加载 TS 源码时会缺失而抛
  // ReferenceError。这里统一注入为 false，与 H5/小程序运行时默认行为一致，让契约测试能导入 client.ts
  // 而不触发 Taro 的 DOM 副作用。
  // 完整列表来自 node_modules/@tarojs/runtime/dist/dom-external/index.js。
  define: {
    ENABLE_INNER_HTML: JSON.stringify(false),
    ENABLE_ADJACENT_HTML: JSON.stringify(false),
    ENABLE_CLONE_NODE: JSON.stringify(false),
    ENABLE_CONTAINS: JSON.stringify(false),
    ENABLE_SIZE_APIS: JSON.stringify(false),
    ENABLE_TEMPLATE_CONTENT: JSON.stringify(false),
    ENABLE_MUTATION_OBSERVER: JSON.stringify(false),
  },
});
