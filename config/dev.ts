import type { UserConfigExport } from '@tarojs/cli';

const config: UserConfigExport<'webpack5'> = {
  env: {
    NODE_ENV: JSON.stringify('development'),
  },
};

export default config;