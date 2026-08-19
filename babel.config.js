// babel 配置：Taro 通过 babel-preset-taro 转换 JSX/ES 语法
module.exports = {
  presets: [
    [
      'taro',
      {
        framework: 'react',
        ts: true,
        compiler: 'webpack5',
      },
    ],
  ],
};