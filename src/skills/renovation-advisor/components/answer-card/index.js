// answer-card 原子组件：仅负责渲染 askRenovation 返回的 chunks + disclaimer
// 约束：组件环境不可用 wx.cloud，所有数据由原子接口注入；本组件不做任何网络请求
Component({
  properties: {
    // structuredContent 来自原子接口返回，形状见 mcp.json outputSchema
    structuredContent: {
      type: Object,
      value: null,
    },
  },
  data: {
    // 按 claim → step → warning 的固定展示顺序整理
    orderedChunks: [],
    disclaimer: '',
  },
  observers: {
    'structuredContent': function (sc) {
      if (!sc || !Array.isArray(sc.chunks)) {
        this.setData({ orderedChunks: [], disclaimer: '' });
        return;
      }
      const order = { claim: 0, step: 1, warning: 2 };
      const ordered = sc.chunks
        .slice()
        .sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
      this.setData({
        orderedChunks: ordered,
        disclaimer: typeof sc.disclaimer === 'string' ? sc.disclaimer : '',
      });
    },
  },
});