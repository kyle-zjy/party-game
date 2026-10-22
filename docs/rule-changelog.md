# 规则变更记录

记录 V1.5 原稿之外的规则决定。原稿内容不在此重复，见 `docs/source/《今夜别想下桌》V1.5 规则书.md`。

来源标记：〔确认〕原稿有冲突或空缺，已由项目负责人正式确认；〔原稿〕确认沿用原稿明文；〔补充〕采纳为数字版新规则的补充方案；〔草案〕待确认，未启用。

## 2026-10-21

| 规则 | 来源 | 变更 | 代码 |
|---|---|---|---|
| 皇帝塔罗（Q1） | 〔确认〕 | 集齐同色三处时该色租金由 3 金提升为 4 金；未集齐不变；不影响购买/抵押价格；被替换后立即恢复 | `tarotEffects.ts` `rentForLanding` |
| 力量塔罗（Q2） | 〔原稿〕 | 碰撞时被撞者后退 3 格（不回起点）；"后退 3 格"事件改为后退 1 格；两项独立不叠加。被撞者后退后的落点不结算格子效果、不引发新碰撞——原稿未写，保留现有引擎约定 | `tarotEffects.ts` `collisionOutcome`、`backSteps`；`turnEngine.ts` `resolveCollisions` |
| 正义塔罗（Q4） | 〔补充〕 | 房主确认现场剪刀石头布结果后，一次性交换赢家与输家的棋盘位置、行动顺序、金币、三国杀手牌；不交换 uid/昵称、地产、德州底牌、身份牌和棋子颜色；无唯一赢家/输家时由房主重新组织，程序不随机指定 | `tarotActions.ts` `applyJusticeSwap` |
| 小姐主牌牌堆（Q10） | 〔补充〕 | 四花色（S/H/D/C）× A–K 共 52 张；开局洗牌并持久化；翻牌从共享牌堆抽；最近 5 张窗口持久化 | `ladyDeck.ts`、`turnEngine.ts` `applyRevealLadyCard` |
| 德国心脏病（Q10） | 〔补充〕 | 最近 5 张中每种花色分别求和，任意一种为正的 5 的倍数即触发；不同花色不混算（取代此前"5 张总和"的临时实现）。数量映射沿用原稿 | `ladyDeck.ts` `heartAttackCheck` |
| 拒绝真心话大冒险（Q13） | 〔补充〕 | "资产"仅指当前金币；上缴 floor(金币/2) 给银行，不转给其他玩家；地产、手牌不变；半杯为线下确认事件，可用非酒精饮品代替；界面事先显示扣除金额 | `turnEngine.ts` `truthOrDareRefusalPenalty`、`applyTruthOrDareResult` |
| 小姐主牌 A–K 牌义（Q6） | 〔草案〕 | 13 张详细规则草案，5、7 为候选牌名。**未启用**，确认前仍由房主现场裁定 | `docs/lady-card-draft.md` |

| 小姐主牌 K（Q6-K） | 〔确认〕 | 国王传承：翻到 K 成为新国王；有上一任任务就先执行（房主确认完成，或跳过，跳过不扣金币不罚酒），再给下一任留任务；第一任直接留任务；同一人连续翻到也一样；任务只能接收/处理/替换一次；禁止危险、侮辱、隐私、身体接触、强制饮酒内容 | `ladyEvents.ts` |
| 小姐主牌 A–Q（Q6） | 〔草案〕 | 按推荐方案做成候选实现，`ladyRuleset = candidate-preview` 时才结算，只能在开发环境创建；正式对局仍房主裁定 | `ladyEvents.ts`、`ladyCards.ts` `candidate` |

### 兼容性

- 本次之前开局的房间：读取时自动补齐主牌牌堆（以开局时间为种子洗牌，所有客户端得到同一副牌），并清空旧的无花色"最近 5 张"窗口（旧窗口无法按花色判定）。正在进行的对局可以继续，不需要删除房间数据。
- Phase D.2 之前开局的房间：读取时补 `ladyRuleset: 'official'`、`ladyEvent: null`、空的 `ladyStatus`、`kingTask: null`、`kingTaskHistory: []`。旧房间里候选牌照旧由房主裁定；K 开始按国王传承结算（第一次翻到 K 的人成为第一任国王）。

## 2026-10-22（Phase D.3–D.6，V1.6 数字版）

全部为〔V1.6 补充〕，只对新房间（`rulesVersion = 2`）生效；之前开局的房间按 V1.5 继续。完整说明见 `docs/rules-v1.6-digital.md`。

| 规则 | 变更 | 代码 |
|---|---|---|
| Q3 命运之轮 | 奇数人数隔 floor(n/2) 配对，落单不换（沿用原实现，正式确认） | `tarotActions.ts` `rotateHands` |
| Q5 节制 | 只禁桃、替喝、吹牛免罚；以水代替/跳过恢复可用（**所有房间**，属于健康选择） | `turnEngine.ts` `applyResolveDrinkAck` |
| Q7 自然 6 | 额外骰再出 6 不连锁（沿用），修正新手文案；删除从未使用的 `NATURAL_SIX_CHAIN` | `turnEngine.ts`、`tutorialLines.ts` |
| Q8 禁令 | 事件 id 去重；禁令与神经病分别录入 | `applyBanCatch`、`applyCrazyCatch` |
| Q9 恋人 | 可以绑定自己（沿用） | — |
| Q11 阿瓦隆 | 3–10 人阵营与五轮上车人数表；身份牌 = 阵营 | `engine/avalon.ts` |
| Q12 渡河 | 双骰 + 神谕；天堂河神固定同意、地狱固定反对 | `engine/zones.ts` `riverVerdict` |
| Q14 特殊格 | 停骰一次 / 下家禁骰；德州+1 / 德扑+1 = 底池 +1 并触发 CASINO | `board.ts`、`turnEngine.ts` |
| Q15 起点 | 安全区（沿用） | — |
| Q16 力量 | 后退后不结算（沿用） | — |
| 小姐牌 A–Q | 12 张候选方案转为正式数字版规则；K 传承中断时记录 | `ladyEvents.ts`、`ladyCards.ts` |
| 三国杀 | 统一响应窗口；闪、无懈可击可用；过河拆桥 = 随机弃目标 1 张手牌 | `engine/tacticStack.ts` |
| 地产抵押 | 抵押 3 / 赎回 4；抵押期间不收租、不算套装 | `tacticStack.ts` `applyMortgage`、`properties.ts` |
| 德州扑克 | 独立牌堆、CASINO 推进、每阶段一轮下注、七选五、平分余数回银行 | `engine/texas.ts` |
| 骗子酒馆 / 月亮 | 在 1 口提醒上吹牛；月亮胜者 +1 银行金 | `texas.ts` |
| 梦幻拖拉机 | 地产/碰撞后可挑战一次，胜者 +1 银行金 | `texas.ts` |
| 神鬼道 / 河道 / 天堂地狱 | 节点取自 PPTX；第一圈后开放；恰好停终点；河神；过桥/渡河 | `godsPath.ts`、`engine/zones.ts` |
| 真心话大冒险 | 内置题库，可换题 | `cards/truthOrDareBank.ts` |
| 终局与计分 | 抵达者回合结束后终局；德州补齐摊牌；阿瓦隆收尾；正式计分与平分规则；结束后冻结 | `engine/endgame.ts` |
| 随机数 | 同一动作的随机结果只产生一次（数据库层生成种子，重试复用） | `gameEngineDb.ts` `actionSeed` |

### 兼容性

- 旧房间读取时补 `rulesVersion: 1`、德州牌堆（以开局时间为种子，从未发出的牌补出）、空的阿瓦隆状态、玩家的 `mortgaged / skipNextRoll / laps / zone / reachedFinish`。旧房间不启用新模块，行为与 V1.5 相同（Q5 以水代替除外）。
