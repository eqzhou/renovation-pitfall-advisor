import path from 'path';
import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import devConfig from './dev';
import prodConfig from './prod';

export default defineConfig<'webpack5'>(async (merge) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'xiaochengxu',
    date: '2026-08-17',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: `dist/${process.env.TARO_ENV}`,
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [
        // 云函数目录拷贝。
        // 注意：webpack5-runner 会把 copy.patterns 的 to 用 resolve(appPath, to) 解释成"项目根下的绝对路径"，
        // 且 from/context 也以项目根为准。所以：
        //   - from 指向项目根下真实路径（本项目 sourceRoot='src'，写 'src/cloudfunctions'）
        //   - to 必须含 outputRoot 前缀 'dist/weapp'，否则会被拷到项目根而不是 dist/weapp。
        {
          from: 'src/cloudfunctions',
          to: 'dist/weapp/cloudfunctions',
          ignore: ['**/*.test.ts', '**/node_modules/**'],
        },
        // 微信 AI 开发模式 SKILL 分包：原生 wxml/wxss/js/json 不经 Taro 编译，直接拷贝到 dist/weapp/skills
        // 独立分包里这些原生文件必须保持原样，否则 SKILL runtime 无法识别
        {
          from: 'src/skills',
          to: 'dist/weapp/skills',
          ignore: ['**/*.test.ts', '**/node_modules/**'],
        },
      ],
      options: {},
    },
    framework: 'react',
    compiler: {
      type: 'webpack5',
      prebundle: { enable: false },
    },
    cache: {
      enable: false,
    },
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
    mini: {
      postcss: {
        pxtransform: { enable: true },
        cssModules: { enable: false },
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      postcss: {
        autoprefixer: { enable: true },
        cssModules: { enable: false },
      },
    },
  };

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});