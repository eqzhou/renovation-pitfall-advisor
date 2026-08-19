import type { UserConfigExport } from '@tarojs/cli';

// 生产环境：交由 Taro 默认的 webpack5 压缩即可，无需显式 terser 配置。
const config: UserConfigExport<'webpack5'> = {};

export default config;