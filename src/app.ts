import Taro from '@tarojs/taro';
import { PropsWithChildren, useEffect } from 'react';
import './app.scss';

/**
 * 小程序入口：负责启动时初始化微信云开发（CloudBase）。
 *
 * - 云函数目录在 src/cloudfunctions，编译后拷贝到 dist/weapp/cloudfunctions
 *   （由 project.config.json 的 cloudfunctionRoot 指向）
 * - `env` 默认走"当前环境自动选择"（需你在微信开发者工具里开通并选定一个环境 ID）
 * - 未开通时仍能跑本地 Mock，不阻塞前端开发，保证透明报错无兜底。
 */
function App({ children }: PropsWithChildren) {
  useEffect(() => {
    const env = process.env.CLOUDBASE_ENV || undefined;
    if (typeof Taro.cloud !== 'undefined' && Taro.cloud.init) {
      try {
        Taro.cloud.init({ env, traceUser: true });
      } catch (err) {
        // 透明报错：未配置云环境时给出明确提示，不静默回退到别的方案
        // eslint-disable-next-line no-console
        console.warn(
          '[CloudBase] 初始化失败，请在微信开发者工具中开通云开发并设置 env：',
          err,
        );
      }
    }
  }, []);

  return children;
}

export default App;