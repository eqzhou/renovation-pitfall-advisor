import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, ScrollView, View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { aiAsk } from '@/api/aiAsk';
import { quotaGet } from '@/api/quotaGet';
import { payOrderCreate } from '@/api/payOrderCreate';
import { aiReport, type ReportHistory } from '@/api/aiReport';
import { feedbackSubmit } from '@/api/feedbackSubmit';
import type {
  AiAnswerChunk,
  AiReportResponse,
  AiScene,
  PayOrderCreateRequest,
  QuotaResponse,
} from '@/cloudfunctions/shared/types';
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

interface UserMsg {
  id: string;
  role: 'user';
  text: string;
  scene?: AiScene;
}
interface AssistantMsg {
  id: string;
  role: 'assistant';
  chunks: AiAnswerChunk[];
  disclaimer: string;
  /** 用户对这条回答的反馈状态：未评价 = undefined */
  feedback?: boolean;
  /** 该回答对应的用户问题（用来在反馈里一起存） */
  question?: string;
}
type Msg = UserMsg | AssistantMsg;

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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [quotaError, setQuotaError] = useState<QuotaErrorKind>('none');
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payingPlan, setPayingPlan] = useState<PayOrderCreateRequest['plan'] | null>(null);

  const [report, setReport] = useState<AiReportResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState<string | null>(null);

  // scrollToBottomId 取最后一条消息的 id（每条消息的 id 都来自 shortId()，全局唯一）。
  // 之前用 `msg-${messages.length}` 作为 id 赋给所有 assistant 消息 → 多条消息重复 id（HTML/WXML 非法），
  // 且最后一条是 user 消息（loading 中）时 scrollIntoView 找不到目标。改为：每条消息各自带稳定 id。
  const scrollToBottomId = useMemo(
    () => (messages.length > 0 ? `msg-${messages[messages.length - 1].id}` : ''),
    [messages],
  );

  /** 会话 sessionId：前端首次生成即固定，用于 report 幂等存储 */
  const sessionId = useMemo(() => shortId('sess_'), []);

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
    const userMsg: Msg = { id: shortId('u_'), role: 'user', text: q, scene: sceneToUse };
    const assistantId = shortId('a_');
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const resp = await aiAsk({ scene: sceneToUse, question: q });
      const assistantMsg: Msg = {
        id: assistantId,
        role: 'assistant',
        chunks: resp.chunks,
        disclaimer: resp.disclaimer,
        question: q,
      };
      setMessages((prev) => [...prev, assistantMsg]);
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

  async function handleFeedback(answerId: string, helpful: boolean, question?: string) {
    setSubmittingFeedback(answerId);
    try {
      // 附带 sessionId：否则 answerId（前端内存短 id）刷新小程序后无法追溯到具体报告/会话
      await feedbackSubmit({ answerId, helpful, question, sessionId });
      setMessages((prev) =>
        prev.map((m) => (m.role === 'assistant' && m.id === answerId ? { ...m, feedback: helpful } : m)),
      );
      Taro.showToast({ title: helpful ? '感谢，已标记为有帮助' : '感谢，已标记为无帮助', icon: 'none' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Taro.showToast({ title: msg, icon: 'none', duration: 3500 });
    } finally {
      setSubmittingFeedback(null);
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
              基于本次会话 {messages.length > 0 ? `已回答 ${messages.filter((m) => m.role === 'assistant').length} 个问题` : '暂无回答'}，
              分类聚合后的核对清单
            </Text>
            <Button size="mini" className="report-actions__btn" loading={reportLoading} onClick={runReport}>
              {report ? '重新生成' : '生成清单'}
            </Button>
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
            <Text className="mine__title">会话</Text>
            <Text className="mine__row">本次 sessionId：{sessionId}</Text>
            <Text className="mine__row mine__row--sub">
              《避坑清单》报告以此 id 作为幂等键保存，关闭小程序后会生成新会话
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
