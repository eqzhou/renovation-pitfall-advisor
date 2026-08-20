import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, ScrollView, View, Text } from '@tarojs/components';
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro';
import { aiAsk } from '@/api/aiAsk';
import { quotaGet } from '@/api/quotaGet';
import { payOrderCreate } from '@/api/payOrderCreate';
import { aiReport, type ReportHistory } from '@/api/aiReport';
import { reportGet } from '@/api/reportGet';
import { feedbackSubmit } from '@/api/feedbackSubmit';
import { feedbackStats } from '@/api/feedbackStats';
import { formatReportToText } from '@/utils/report-format';
import type {
  AiReportResponse,
  AiScene,
  FeedbackStatsResponse,
  PayOrderCreateRequest,
  QuotaResponse,
} from '@/cloudfunctions/shared/types';
import {
  appendAssistant,
  appendUser,
  createSession,
  setActiveSceneOf,
  setFeedbackOf,
  sortByUpdatedAtDesc,
  trimSessions,
  type PersistedAssistantMsg,
  type PersistedMsg as Msg,
  type PersistedSession,
  type PersistedUserMsg,
} from '@/storage/session-pure';
import {
  loadCurrentId,
  loadSessions,
  saveCurrentId,
  saveSessions,
} from '@/storage/session-storage';
import './index.scss';

/** 6 个快捷场景模板：降低"空白对话"门槛 */
const SCENE_TEMPLATES: { id: AiScene; title: string; prompt: string }[] = [
  { id: 'budget', title: '预算超支', prompt: '我家 90㎡，硬装预算 12 万，容易在哪里被加钱？' },
  { id: 'contract', title: '合同避坑', prompt: '签装修合同前必须写死哪几条，后期不扯皮？' },
  { id: 'plumbing', title: '水电改造', prompt: '水电改造怎么避免被"绕线算米"？' },
  { id: 'waterproof', title: '防水验收', prompt: '卫生间闭水试验怎么才算真正合格？' },
  { id: 'acceptance', title: '阶段验收', prompt: '中期验收最容易漏掉的致命项有哪些？' },
  { id: 'materials', title: '主材进场', prompt: '瓷砖/板材/乳胶漆进场，怎么核对不被调包？' },
];

const CATEGORY_LABELS: Record<string, string> = {
  budget: '预算超支',
  contract: '合同避坑',
  plumbing: '水电改造',
  waterproof: '防水验收',
  acceptance: '阶段验收',
  materials: '主材进场',
  general: '通用建议',
};

/** 付费计划展示与请求参数一一对应（与云函数 PRICE_CENT_BY_PLAN 保持一致） */
const UNLOCK_PLANS: {
  id: PayOrderCreateRequest['plan'];
  label: string;
  price: string;
  tagline: string;
  highlight?: boolean;
}[] = [
  { id: 'unlock_day', label: '单日', price: '¥1.99', tagline: '今日无限次' },
  {
    id: 'unlock_week',
    label: '一周',
    price: '¥5.99',
    tagline: '装修决策高峰期用',
    highlight: true,
  },
  { id: 'unlock_month', label: '一月', price: '¥19.99', tagline: '覆盖工期关键期' },
  { id: 'unlock_forever', label: '永久', price: '¥129.99', tagline: '全家装修一本通' },
];

type Tab = 'chat' | 'report' | 'mine';

// Msg / PersistedSession 等消息与会话类型统一来自 @/storage/session-pure
// （持久化数据模型），避免页面内重复定义导致两套漂移。

type QuotaErrorKind = 'none' | 'rate';

/** 简单的前端 uuid：不需要强加密，只要前端唯一 */
function shortId(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 6 大场景顺序（清单报告里的分类排序） */
const CATEGORY_ORDER: string[] = [
  'budget',
  'contract',
  'plumbing',
  'waterproof',
  'acceptance',
  'materials',
  'general',
];

export default function Index() {
  const [tab, setTab] = useState<Tab>('chat');

  const [input, setInput] = useState('');
  const [activeScene, setActiveScene] = useState<AiScene | undefined>(undefined);

  /**
   * 会话持久化：sessions 全量存本地 storage，currentId 指向当前会话。
   * 消息不再用独立 messages state —— 一律从 current 会话派生，
   * 任何变更经 updateCurrent 写回 storage，刷新小程序不丢。
   */
  const [sessions, setSessions] = useState<PersistedSession[]>(() => {
    let stored = loadSessions();
    if (stored.length === 0) {
      // 首次进入：创建默认会话并立即落盘（避免 useEffect 二次初始化，经验 162304）
      const fresh = createSession(shortId('sess_'));
      saveSessions([fresh]);
      stored = [fresh];
    }
    return stored;
  });
  const [currentId, setCurrentId] = useState<string>(() => {
    const saved = loadCurrentId();
    if (saved && sessions.some((s) => s.id === saved)) return saved;
    const first = sessions[0];
    if (first) {
      saveCurrentId(first.id);
      return first.id;
    }
    return '';
  });

  const current = useMemo(
    () => sessions.find((s) => s.id === currentId) ?? null,
    [sessions, currentId],
  );
  const messages: Msg[] = current?.messages ?? [];
  /** 随会话持久化的 sessionId（刷新不再重建） */
  const sessionId = current?.id ?? '';

  const [loading, setLoading] = useState(false);

  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [quotaError, setQuotaError] = useState<QuotaErrorKind>('none');
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payingPlan, setPayingPlan] = useState<PayOrderCreateRequest['plan'] | null>(null);

  const [report, setReport] = useState<AiReportResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState<string | null>(null);

  /** 转发卡片携带的报告 id：`pages/index/index?reportId=xxx`，供分享接收端读取 */
  const router = useRouter();
  const shareReportId = (router.params && router.params.reportId) || '';

  // 从分享卡片进入：按 reportId 取回已保存的报告并切到报告 tab（仅挂载时执行一次）
  useEffect(() => {
    if (!shareReportId) return;
    let cancelled = false;
    setReportLoading(true);
    reportGet(shareReportId)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setTab('report');
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        Taro.showToast({ title: `报告加载失败：${msg}`, icon: 'none', duration: 3500 });
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareReportId]);

  // 右上角转发：有报告时携带 reportId，让接收端可加载同一份报告
  useShareAppMessage(() => {
    if (report) {
      return {
        title: `装修避坑清单｜已汇总 ${report.coveredQuestions} 个问题`,
        path: `pages/index/index?reportId=${report.reportId}`,
      };
    }
    return { title: '装修避坑顾问 · AI 帮你避开装修坑', path: 'pages/index/index' };
  });

  // scrollToBottomId 取最后一条消息的 id（每条消息的 id 都来自 shortId()，全局唯一）。
  // 之前用 `msg-${messages.length}` 作为 id 赋给所有 assistant 消息 → 多条消息重复 id（HTML/WXML 非法），
  // 且最后一条是 user 消息（loading 中）时 scrollIntoView 找不到目标。改为：每条消息各自带稳定 id。
  const scrollToBottomId = useMemo(
    () => (messages.length > 0 ? `msg-${messages[messages.length - 1].id}` : ''),
    [messages],
  );

  /** 对当前会话做纯函数更新并写回 storage（唯一写入口，保证持久化一致） */
  const updateCurrent = useCallback(
    (updater: (s: PersistedSession) => PersistedSession) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === currentId);
        if (idx < 0) return prev;
        const next = updater(prev[idx]);
        const arr = prev.slice();
        arr[idx] = next;
        saveSessions(arr);
        return arr;
      });
    },
    [currentId],
  );

  /** 切换会话：恢复该会话场景，清空输入与报告（防止串会话） */
  function switchSession(id: string) {
    if (id === currentId) return;
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    setCurrentId(id);
    saveCurrentId(id);
    setActiveScene(target.activeScene);
    setInput('');
    setReport(null);
  }

  /** 新建会话：追加到列表头部并切换过去（超量自动裁剪） */
  function createNewSession() {
    const fresh = createSession(shortId('sess_'));
    const arr = trimSessions([fresh, ...sessions]);
    setSessions(arr);
    saveSessions(arr);
    setCurrentId(fresh.id);
    saveCurrentId(fresh.id);
    setActiveScene(undefined);
    setInput('');
    setReport(null);
    setTab('chat');
  }

  /** 删除会话：删空则自动补一个全新会话；删的是当前会话则切到最近一个 */
  function deleteSession(id: string) {
    const remaining = sessions.filter((s) => s.id !== id);
    const arr = remaining.length > 0 ? remaining : [createSession(shortId('sess_'))];
    setSessions(arr);
    saveSessions(arr);
    if (id === currentId) {
      const nextId = arr[0].id;
      setCurrentId(nextId);
      saveCurrentId(nextId);
      setActiveScene(arr[0].activeScene);
      setReport(null);
    }
  }

  const refreshQuota = useCallback(async () => {
    try {
      const q = await quotaGet();
      setQuota(q);
      setQuotaError('none');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQuota(null);
      if (!/CloudBase|appid|未就绪/i.test(msg)) setQuotaError('rate');
      Taro.showToast({ title: msg, icon: 'none', duration: 3000 });
    }
  }, []);

  // 只在 useDidShow 里触发（小程序首次进入 useDidShow 就会触发一次）。
  // 之前同时挂 useEffect 会导致"首挂 + 首次 show"双触发，配额接口调 2 次（经验 162304）。
  useDidShow(() => {
    refreshQuota();
  });

  async function submit(question?: string, scene?: AiScene) {
    const q = (question ?? input).trim();
    if (!q) {
      Taro.showToast({ title: '请输入你的问题', icon: 'none' });
      return;
    }
    const sceneToUse = scene ?? activeScene;
    const userMsg: PersistedUserMsg = { id: shortId('u_'), role: 'user', text: q, scene: sceneToUse };
    const assistantId = shortId('a_');
    // user 消息立即持久化：提问即写入 storage，加载中刷新也不丢
    updateCurrent((s) => appendUser(s, userMsg));
    setInput('');
    setLoading(true);

    try {
      const resp = await aiAsk({ scene: sceneToUse, question: q });
      const assistantMsg: PersistedAssistantMsg = {
        id: assistantId,
        role: 'assistant',
        chunks: resp.chunks,
        disclaimer: resp.disclaimer,
        question: q,
        followUps: resp.followUps,
      };
      updateCurrent((s) => appendAssistant(s, assistantMsg));
      await refreshQuota();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/429|今日免费|已达上限/i.test(msg)) {
        await refreshQuota();
        setPayModalOpen(true);
      } else if (/504|超时|timeout/i.test(msg)) {
        // 504 是 AI 慢/网络慢 → 给个更友好的提示 + 建议重问
        Taro.showToast({
          title: 'AI 正在忙，请稍后重试或换个问法',
          icon: 'none',
          duration: 3500,
        });
        // 把用户刚发的问题回填到输入框，避免再打一遍
        setInput(q);
      } else {
        Taro.showToast({ title: msg, icon: 'none', duration: 3500 });
      }
    } finally {
      setLoading(false);
    }
  }

  function pickTemplate(tpl: (typeof SCENE_TEMPLATES)[number]) {
    setActiveScene(tpl.id);
    updateCurrent((s) => setActiveSceneOf(s, tpl.id));
    submit(tpl.prompt, tpl.id);
  }

  /** plan id → QuotaResponse.plan 的映射（pay-order-create/impl 里 PLAN_TO_META 解出来的结果），用于乐观更新 */
  const PAYPLAN_TO_QUOTAPLAN: Record<PayOrderCreateRequest['plan'], QuotaResponse['plan']> = {
    unlock_day: 'day',
    unlock_week: 'week',
    unlock_month: 'month',
    unlock_forever: 'forever',
  };

  async function handlePay(plan: PayOrderCreateRequest['plan']) {
    setPayingPlan(plan);
    try {
      const order = await payOrderCreate({ plan });
      if (order.payParams) {
        try {
          await Taro.requestPayment({
            timeStamp: order.payParams.timeStamp,
            nonceStr: order.payParams.nonceStr,
            package: order.payParams.package,
            signType: order.payParams.signType,
            paySign: order.payParams.paySign,
          });
          // 支付成功但 pay-notify 回调是异步的（通常几秒-几十秒延迟），
          // 立即乐观写 quota 为 paid=true，避免用户看到"还是免费额度"的焦虑。
          // 1s 后再刷一次真实额度。
          const quotaPlan = PAYPLAN_TO_QUOTAPLAN[plan];
          setQuota({
            used: 0,
            limit: quota?.limit ?? 5,
            paid: true,
            plan: quotaPlan,
          });
          setPayModalOpen(false);
          Taro.showToast({ title: '支付成功，已解锁', icon: 'success' });
          setTimeout(() => {
            void refreshQuota();
          }, 1000);
        } catch (payErr) {
          const detail = payErr instanceof Error ? payErr.message : String(payErr);
          if (/cancel|取消/i.test(detail)) {
            Taro.showToast({ title: '已取消支付', icon: 'none' });
          } else {
            Taro.showToast({ title: `支付失败：${detail}`, icon: 'none', duration: 3500 });
          }
        }
      } else if (order.hint) {
        await Taro.showModal({
          title: '尚未开通真支付',
          content: `订单号：${order.orderId}\n\n${order.hint}`,
          showCancel: false,
          confirmText: '我知道了',
        });
      } else {
        Taro.showToast({ title: `订单创建异常：${order.orderId}`, icon: 'none' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Taro.showToast({ title: msg, icon: 'none', duration: 3500 });
    } finally {
      setPayingPlan(null);
    }
  }

  /** 从首页 history 生成《避坑清单》：切换到 report tab 时会触发；失败切到 tab 后仍给出明确提示 */
  async function runReport() {
    setReportLoading(true);
    try {
      const history = messages.map((m) =>
        m.role === 'user'
          ? { role: 'user' as const, text: m.text, scene: m.scene }
          : {
              role: 'assistant' as const,
              chunks: m.chunks.map((c) => ({ type: c.type, content: c.content })),
              disclaimer: m.disclaimer,
            },
      ) as ReportHistory;
      const r = await aiReport({ sessionId, history });
      setReport(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Taro.showToast({ title: msg, icon: 'none', duration: 3500 });
    } finally {
      setReportLoading(false);
    }
  }

  /** 当 tab 切换到 report 并且当前没有已生成的报告 → 立即尝试生成一次 */
  useEffect(() => {
    if (tab === 'report' && !report && messages.length > 0) {
      runReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /** 把当前报告导出为 Markdown 文本并复制到剪贴板 */
  async function copyReport() {
    if (!report) return;
    try {
      await Taro.setClipboardData({ data: formatReportToText(report) });
      Taro.showToast({ title: '已复制，可粘贴到备忘录或发给家人', icon: 'none', duration: 2500 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Taro.showToast({ title: `复制失败：${msg}`, icon: 'none' });
    }
  }

  async function handleFeedback(answerId: string, helpful: boolean, question?: string) {
    setSubmittingFeedback(answerId);
    try {
      // 附带 sessionId：answerId 为前端短 id，靠 sessionId 才能追溯到具体会话/报告
      await feedbackSubmit({ answerId, helpful, question, sessionId });
      // 反馈状态写入当前会话并持久化（刷新后仍保留"已评价"）
      updateCurrent((s) => setFeedbackOf(s, answerId, helpful));
      Taro.showToast({ title: helpful ? '感谢，已标记为有帮助' : '感谢，已标记为无帮助', icon: 'none' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Taro.showToast({ title: msg, icon: 'none', duration: 3500 });
    } finally {
      setSubmittingFeedback(null);
    }
  }

  /** 反馈复盘 state */
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [stats, setStats] = useState<FeedbackStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  /** 加载反馈复盘统计 */
  async function loadStats() {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const s = await feedbackStats();
      setStats(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatsError(msg);
      if (!/403|仅管理员/i.test(msg)) {
        Taro.showToast({ title: msg, icon: 'none', duration: 3500 });
      }
    } finally {
      setStatsLoading(false);
    }
  }

  function quotaText(q: QuotaResponse | null): { label: string; hint?: string } {
    if (!q) return { label: quotaError === 'rate' ? '额度加载失败' : '连接云开发…' };
    if (q.paid) {
      const tag =
        q.plan === 'forever'
          ? '永久解锁'
          : q.plan === 'month'
            ? '月度解锁中'
            : q.plan === 'week'
              ? '周卡解锁中'
              : q.plan === 'day'
                ? '日卡解锁中'
                : '付费已解锁';
      return { label: tag, hint: '今日不限制提问次数' };
    }
    return {
      label: `今日免费：${q.used}/${q.limit}`,
      hint: q.used >= q.limit ? '已用完，点击解锁更多' : `还剩 ${q.limit - q.used} 次`,
    };
  }

  const quotaMeta = quotaText(quota);
  const percentUsed =
    quota && quota.limit > 0 && !quota.paid
      ? Math.min(100, Math.round((quota.used / quota.limit) * 100))
      : 0;

  /** 报告按分类顺序展示：CATEGORY_ORDER */
  const orderedItems = useMemo(() => {
    if (!report) return [];
    return CATEGORY_ORDER.flatMap((cat) => report.items.filter((it) => it.category === cat));
  }, [report]);

  /** 会话列表按最近更新降序展示 */
  const sortedSessions = useMemo(() => sortByUpdatedAtDesc(sessions), [sessions]);

  return (
    <View className="page">
      {/* Tab 导航：使用 role="tablist" / role="tab" 与 aria-selected 标记选中态，兼容辅助技术 */}
      <View className="tabs" role="tablist">
        <View
          className={`tabs__item ${tab === 'chat' ? 'tabs__item--active' : ''}`}
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
        >
          问答
        </View>
        <View
          className={`tabs__item ${tab === 'report' ? 'tabs__item--active' : ''}`}
          role="tab"
          aria-selected={tab === 'report'}
          onClick={() => setTab('report')}
        >
          避坑清单
        </View>
        <View
          className={`tabs__item ${tab === 'mine' ? 'tabs__item--active' : ''}`}
          role="tab"
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
        >
          我的
        </View>
      </View>

      {tab === 'chat' && (
        <>
          <View
            className={`quota ${quota && quota.paid ? 'quota--paid' : ''}`}
            onClick={() => setPayModalOpen(true)}
          >
            <View className="quota__left">
              <Text className="quota__label">{quotaMeta.label}</Text>
              {quotaMeta.hint && <Text className="quota__hint">{quotaMeta.hint}</Text>}
            </View>
            <View className="quota__right">
              {quota && !quota.paid && (
                <View className="quota__bar">
                  <View className="quota__bar-fill" style={{ width: `${percentUsed}%` }} />
                </View>
              )}
              <Text className="quota__cta">{quota && quota.paid ? '查看权益' : '解锁'}</Text>
            </View>
          </View>

          <View className="header">
            <Text className="header__title">装修避坑顾问</Text>
            <Text className="header__subtitle">
              6 个高频场景一键提问 · 分步骤结构化答复
            </Text>
          </View>

          <View className="templates">
            {SCENE_TEMPLATES.map((tpl) => (
              <Button
                key={tpl.id}
                size="mini"
                className={`tpl tpl--${tpl.id} ${activeScene === tpl.id ? 'tpl--active' : ''}`}
                onClick={() => pickTemplate(tpl)}
                disabled={loading}
              >
                {tpl.title}
              </Button>
            ))}
          </View>

          <ScrollView scrollY className="chat" scrollIntoView={scrollToBottomId} scrollWithAnimation>
            {messages.length === 0 && (
              <View className="chat__empty">
                <Text className="chat__empty-title">你现在在装修哪个阶段？</Text>
                <Text className="chat__empty-desc">
                  选中上方场景卡，或直接在下方输入你的具体问题。
                </Text>
              </View>
            )}

            {messages.map((m) => (
              <View key={m.id} id={`msg-${m.id}`} className="msg">
                {m.role === 'user' ? (
                  <View className="msg msg--user">
                    <Text className="msg__bubble">{m.text}</Text>
                  </View>
                ) : (
                  <View className="msg msg--assistant">
                    {m.chunks.map((c, j) => (
                      <View key={j} className={`chunk chunk--${c.type}`}>
                        {c.type === 'claim' && <Text className="chunk__tag">结论</Text>}
                        {c.type === 'step' && <Text className="chunk__tag">步骤</Text>}
                        {c.type === 'warning' && <Text className="chunk__tag">提醒</Text>}
                        <Text className="chunk__text">{c.content}</Text>
                      </View>
                    ))}
                    <Text className="disclaimer">{m.disclaimer}</Text>
                    {m.followUps && m.followUps.length > 0 && (
                      <View className="followups">
                        <Text className="followups__label">补充这些信息，回答会更准确：</Text>
                        <View className="followups__chips">
                          {m.followUps.map((fu, i) => (
                            <Button
                              key={i}
                              size="mini"
                              className="followups__chip"
                              disabled={loading}
                              onClick={() => {
                                // 点击把追问填入输入框，用户补全信息后发送（形成多轮）
                                setInput(fu);
                              }}
                            >
                              {fu}
                            </Button>
                          ))}
                        </View>
                      </View>
                    )}
                    <View className="feedback-row">
                      <Button
                        size="mini"
                        className={`feedback-btn ${m.feedback === true ? 'feedback-btn--pressed' : ''}`}
                        loading={submittingFeedback === m.id}
                        disabled={submittingFeedback !== null || m.feedback !== undefined}
                        onClick={() => handleFeedback(m.id, true, m.question)}
                      >
                        有帮助
                      </Button>
                      <Button
                        size="mini"
                        className={`feedback-btn ${m.feedback === false ? 'feedback-btn--pressed feedback-btn--bad' : 'feedback-btn--bad'}`}
                        loading={submittingFeedback === m.id}
                        disabled={submittingFeedback !== null || m.feedback !== undefined}
                        onClick={() => handleFeedback(m.id, false, m.question)}
                      >
                        无帮助
                      </Button>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>

          <View className="composer">
            <Input
              className="composer__input"
              type="text"
              value={input}
              aria-label="描述装修问题"
              placeholder={
                activeScene
                  ? `在「${SCENE_TEMPLATES.find((s) => s.id === activeScene)?.title}」场景下提问，例如：「预算超支哪里会被加钱？」…`
                  : '描述具体装修问题，例如「90 平 15 万预算会被加钱吗？」…'
              }
              placeholderClass="composer__placeholder"
              maxlength={1000}
              onInput={(e) => setInput(e.detail.value)}
              onConfirm={() => submit()}
              confirmType="send"
              disabled={loading}
            />
            <Button
              className="composer__send"
              size="mini"
              onClick={() => submit()}
              disabled={loading || !input.trim()}
            >
              {loading ? '…' : '发送'}
            </Button>
          </View>
        </>
      )}

      {tab === 'report' && (
        <View className="report-page">
          <View className="report-header">
            <Text className="report-header__title">《避坑清单》</Text>
            <Text className="report-header__sub">
              {shareReportId
                ? '来自好友分享的避坑清单'
                : `基于本次会话 ${messages.length > 0 ? `已回答 ${messages.filter((m) => m.role === 'assistant').length} 个问题` : '暂无回答'}，分类聚合后的核对清单`}
            </Text>
            <View className="report-actions">
              <Button size="mini" className="report-actions__btn" loading={reportLoading} onClick={runReport}>
                {report ? '重新生成' : '生成清单'}
              </Button>
              {report && (
                <>
                  <Button
                    size="mini"
                    className="report-actions__btn report-actions__btn--ghost"
                    onClick={copyReport}
                  >
                    复制清单
                  </Button>
                  <Button
                    size="mini"
                    className="report-actions__btn report-actions__btn--ghost"
                    openType="share"
                  >
                    分享
                  </Button>
                </>
              )}
            </View>
          </View>

          {report ? (
            <ScrollView scrollY className="report-list">
              <View className="report-meta">
                <Text className="report-meta__item">报告 ID：{report.reportId}</Text>
                <Text className="report-meta__item">
                  生成时间：{new Date(report.createdAt).toLocaleString()}
                </Text>
                <Text className="report-meta__item">覆盖问题：{report.coveredQuestions} 个</Text>
              </View>

              {orderedItems.length === 0 && (
                <View className="report-empty">当前无可聚合的分类项</View>
              )}

              {orderedItems.map((it, idx) => (
                <View key={idx} className="report-item">
                  <View className="report-item__cat">
                    {CATEGORY_LABELS[it.category] || it.category}
                  </View>
                  <View className="report-item__claim">• {it.claim}</View>
                  {it.checks.length > 0 && (
                    <View className="report-item__checks">
                      <Text className="report-item__sub">逐项核对：</Text>
                      {it.checks.map((c, i) => (
                        <Text key={i} className="report-item__check">
                          □ {c}
                        </Text>
                      ))}
                    </View>
                  )}
                  {it.warnings.length > 0 && (
                    <View className="report-item__warnings">
                      <Text className="report-item__sub">风险提醒：</Text>
                      {it.warnings.map((w, i) => (
                        <Text key={i} className="report-item__warn">
                          ⚠ {w}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              ))}

              <View className="report-disclaimer">{report.disclaimer}</View>
            </ScrollView>
          ) : (
            <View className="report-empty">
              {reportLoading ? '正在生成清单…' : messages.length === 0 ? '先去问答 tab 提几个问题，再来生成清单' : '点击上方生成清单'}
            </View>
          )}
        </View>
      )}

      {tab === 'mine' && (
        <View className="mine">
          <View className="mine__card">
            <Text className="mine__title">额度 / 权益</Text>
            <Text className="mine__row">{quotaMeta.label}</Text>
            {quotaMeta.hint && <Text className="mine__row mine__row--sub">{quotaMeta.hint}</Text>}
            <Button size="mini" className="mine__btn" onClick={() => setPayModalOpen(true)}>
              解锁更多
            </Button>
          </View>
          <View className="mine__card">
            <View className="mine__card-head">
              <Text className="mine__title">会话历史</Text>
              <Button size="mini" className="mine__btn mine__btn--ghost" onClick={createNewSession}>
                新会话
              </Button>
            </View>
            <Text className="mine__row mine__row--sub">
              消息已本地持久化，刷新小程序不丢；当前 {sessions.length} 个会话
            </Text>
            {sortedSessions.length === 0 ? (
              <Text className="mine__row mine__row--sub">暂无历史会话</Text>
            ) : (
              <View className="session-list">
                {sortedSessions.map((s) => {
                  const answerCount = s.messages.filter((m) => m.role === 'assistant').length;
                  return (
                    <View
                      key={s.id}
                      className={`session-item ${s.id === currentId ? 'session-item--active' : ''}`}
                    >
                      <View className="session-item__main" onClick={() => switchSession(s.id)}>
                        <Text className="session-item__title">{s.title}</Text>
                        <Text className="session-item__meta">
                          {new Date(s.updatedAt).toLocaleString()} · {answerCount} 条回答
                        </Text>
                      </View>
                      <Text
                        className="session-item__del"
                        onClick={() => deleteSession(s.id)}
                      >
                        删除
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
          <View className="mine__card">
            <View className="mine__card-head">
              <Text className="mine__title">反馈复盘（管理员）</Text>
              <Button
                size="mini"
                className="mine__btn mine__btn--ghost"
                loading={statsLoading}
                onClick={() => {
                  setStatsModalOpen(true);
                  void loadStats();
                }}
              >
                查看统计
              </Button>
            </View>
            <Text className="mine__row mine__row--sub">
              近 7 天帮助率 / 每日分布 / 无帮助问题 Top，仅配置了 ADMIN_OPENIDS 白名单的管理员可见
            </Text>
          </View>
          <View className="mine__card">
            <Text className="mine__title">关于</Text>
            <Text className="mine__row">装修避坑顾问 · AI 垂直顾问</Text>
            <Text className="mine__row mine__row--sub">
              所有建议由 AI 整理行业资料生成，仅作参考，不替代施工/合同/验收等专业决策。
            </Text>
          </View>
        </View>
      )}

      {statsModalOpen && (
        <View className="modal-mask" onClick={() => setStatsModalOpen(false)}>
          <View className="modal modal--center" onClick={(e) => e.stopPropagation()}>
            <View className="modal__header">
              <Text className="modal__title">反馈复盘</Text>
              <Text className="modal__close" onClick={() => setStatsModalOpen(false)}>
                ×
              </Text>
            </View>
            <ScrollView scrollY className="stats-body">
              {statsLoading && <Text className="stats__empty">正在统计…</Text>}
              {!statsLoading && statsError && (
                <View>
                  <Text className="stats__empty">统计不可用</Text>
                  <Text className="stats__hint">{statsError}</Text>
                </View>
              )}
              {!statsLoading && !statsError && stats && (
                <View>
                  <View className="stats-grid">
                    <View className="stats-cell">
                      <Text className="stats-cell__num">{stats.total}</Text>
                      <Text className="stats-cell__label">总反馈</Text>
                    </View>
                    <View className="stats-cell stats-cell--good">
                      <Text className="stats-cell__num">{stats.helpful}</Text>
                      <Text className="stats-cell__label">有帮助</Text>
                    </View>
                    <View className="stats-cell stats-cell--bad">
                      <Text className="stats-cell__num">{stats.unhelpful}</Text>
                      <Text className="stats-cell__label">无帮助</Text>
                    </View>
                    <View className="stats-cell">
                      <Text className="stats-cell__num">{stats.helpfulRate}%</Text>
                      <Text className="stats-cell__label">帮助率</Text>
                    </View>
                  </View>

                  <Text className="stats__title">每日分布（近 {stats.daily.length} 天）</Text>
                  <View className="stats-daily">
                    {stats.daily.map((d) => (
                      <View key={d.date} className="stats-daily__row">
                        <Text className="stats-daily__date">{d.date.slice(5)}</Text>
                        <View className="stats-daily__bar">
                          <View
                            className="stats-daily__fill"
                            style={{ width: `${d.total === 0 ? 0 : Math.max(8, (d.total / 30) * 100)}%` }}
                          />
                        </View>
                        <Text className="stats-daily__count">{d.total}</Text>
                      </View>
                    ))}
                  </View>

                  <Text className="stats__title">无帮助问题 Top</Text>
                  {stats.topUnhelpfulQuestions.length === 0 ? (
                    <Text className="stats__hint">暂无无帮助问题（表现很好）</Text>
                  ) : (
                    stats.topUnhelpfulQuestions.map((q, i) => (
                      <View key={i} className="stats-top">
                        <Text className="stats-top__idx">{i + 1}</Text>
                        <Text className="stats-top__q">{q.question}</Text>
                        <Text className="stats-top__count">{q.count} 次</Text>
                      </View>
                    ))
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {payModalOpen && (
        <View className="modal-mask" onClick={() => !payingPlan && setPayModalOpen(false)}>
          <View className={`modal${payingPlan ? ' modal--paying' : ''}`} onClick={(e) => e.stopPropagation()}>
            <View className="modal__header">
              <Text className="modal__title">解锁更多咨询</Text>
              <Text
                className="modal__close"
                // Taro 的 Text 组件类型定义不接受 role/aria-label，通过 data-* 留痕给原生渲染层
                // （小程序实际读 aria-label 需要用原生组件属性，但 Taro Text 在小程序端是 text 节点，
                //  作为关闭按钮本身是纯视觉，这里仅保证 TS 类型通过）
                onClick={() => !payingPlan && setPayModalOpen(false)}
              >
                ×
              </Text>
            </View>
            <View className="plans">
              {UNLOCK_PLANS.map((p) => (
                <View
                  key={p.id}
                  className={`plan ${p.highlight ? 'plan--highlight' : ''} ${payingPlan === p.id ? 'plan--loading' : ''}`}
                >
                  <Text className="plan__label">{p.label}</Text>
                  <Text className="plan__price">{p.price}</Text>
                  <Text className="plan__tagline">{p.tagline}</Text>
                  <Button
                    className="plan__btn"
                    size="mini"
                    loading={payingPlan === p.id}
                    disabled={Boolean(payingPlan)}
                    onClick={() => handlePay(p.id)}
                  >
                    购买
                  </Button>
                </View>
              ))}
            </View>
            <Text className="modal__footnote">
              完成支付后立即生效。支付成功但未解锁请刷新小程序。
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
