export default defineAppConfig({
  pages: ['pages/index/index'],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1f1f23',
    navigationBarTitleText: '装修避坑顾问',
    navigationBarTextStyle: 'white',
    backgroundColor: '#1f1f23',
  },
  // —— 微信 AI 开发模式接入（基础库 ≥ 3.16.1） ——
  // 1) 全局开启按需注入（SKILL 声明的硬性前提）
  lazyCodeLoading: 'requiredComponents',
  // 2) 允许在原子接口环境使用 wx.cloud.* 直连云开发（复用 ai-ask 云函数）
  cloud: true,
  // 3) SKILL 必须放在独立分包里
  subPackages: [
    {
      root: 'skills/renovation-advisor',
      independent: true,
      pages: [],
    },
  ],
  // 4) 向微信 AI 声明本小程序提供的技能清单
  agent: {
    // 全局提示词文件（路径相对小程序根目录；最大 10000 字节）
    instruction: 'skills/renovation-advisor/AGENTS.md',
    skills: [
      {
        name: 'renovationAdvisor',
        description: '装修避坑顾问：用户用自然语言提装修问题，AI 调用本技能获得分步骤结构化的避坑建议',
        path: 'skills/renovation-advisor',
      },
    ],
  },
});