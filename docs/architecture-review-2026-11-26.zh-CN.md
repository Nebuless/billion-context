# 架构评审：模块深化候选

评审快照：2026-11-26，仓库提交 `2c2190f80e8077a094df3aab50189387e852d6b1`。以下是研究候选，不是已批准设计或已确认缺陷。方法：[improve-codebase-architecture](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture)；优先抽查近期请求链路和存储/身份变更。[可视报告](architecture-review-2026-11-26.html)仅英文，本文和英文版记录完整结论。未发现词汇表或 ADR 目录。两名研究者独立报告，另一个 OMO 会话综合；其子代理因委派工具未激活而无法启动。已检查源码和测试，但未运行测试，也未全面审计。

## 排序候选

1. **强烈建议——preflight 单次执行生命周期。** `src/server.ts:4219–4252` 的门控、`src/server.ts:4709–4723` 的中止处理、`src/fold-reconcile.ts:2512–2521` 的 epoch 重置，以及重建和持久化共同承担状态知识。探索集中生命周期转换，而非增加布尔包装。删除门控只会把规则转移给调用方。集中后可提高局部性和转换测试的复用；须保留快速失败重试、fork 继承和 epoch 行为，以及 `tests/preflight-one-shot-gate.test.ts` 的请求级覆盖。
2. **强烈建议，语义敏感——msgid pin 判定。** `src/snapshot/stage0.ts:145–282` 与 `src/server/prepare-anthropic.ts:243–299` 均涉及全量/尾部判定，但不能假设策略相同。探索共享判定并显式保留车道差异；删除任一协调逻辑只会把策略移给调用方。覆盖真实 wire、空账本、损坏尾部、优先级和重叠校验；保留 KDD #21–22 和 `tests/issue5874-2x2-p3.test.ts`。
3. **值得探索——egress authority 单轮生命周期。** `src/server/egress-lane-io.ts:132–262` 已集中 authority，`src/server/prepare-openai.ts:366–383,697–719,955–975` 仍分散记录和顺序知识。删除现有接缝会分散真实策略。探索剩余协调逻辑，但不得抹平 kernel 前后各车道顺序；保留 KDD #23、故障处理和先记录后服务，并在 `tests/issue7574-egress-seam.test.ts` 之外测试真实适配器。
4. **值得探索——响应提交与上游大小裁决。** `src/server.ts:3530–3573` 可能提前提交响应，影响 `src/server/relay.ts:2179–2240` 的后续处理。移除任一机制只会转移生命周期问题。探索集中处理已提交/未提交状态；覆盖流式和非流式、大小及非大小错误。已提交后不能补响应头；KDD #19 禁止估算拒发。
5. **推测性——投影 authority。** `src/storage/store.ts:2079–2113` 选择 pin 来源，`src/persist.ts:2839–2851,3327–3354` 分别处理副本和投影。语义并不相同；删除 pin 接缝会分散来源选择。合并之前先明确职责并补集成证据，保留 KDD #23 和 `tests/egress-lazy-projection.test.ts`。

## 待核实的决策文本差异

- KDD #7、`docs/technical-notes.md:188–212` 与条件性 nudge 路径需要精确追踪插件模式，才能决定如何修正。
- KDD #19 描述向 JSON 合并证据；`src/server/relay.ts:2179–2217` 保留上游响应体并在可能时加头。须明确预期契约，包括已提交响应。
- KDD #9 的 persona 概述似乎比 `src/server/handle.ts:1546–1570` 的限定路径更宽；修改身份逻辑前须确认有效裁定。

## 下一阶段

先研究 preflight 生命周期，确认源码中的转换、fork 和持久化行为，并梳理两种压缩模式的请求级测试。独立调查上述三项文本差异；未经 owner 澄清，不预断源码或文档哪个正确。与 owner 选定候选后才设计接口或实现。结论基于评审快照，必须对当前代码重新验证。
