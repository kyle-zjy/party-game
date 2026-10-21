/**
 * Phase C：正式游戏的共享类型定义。
 *
 * 设计前提（和 shared/gameRoomTypes.ts 的关系）：
 * `GameRoom`（阶段 B）增加一个可选字段 `game: GameState`，游戏开始后才存在。
 * 所有游戏内的并发写入仍然复用 `GameRoom.version` 做乐观锁——不新增第二套
 * 版本号，理由见 `frontend/src/lib/gameEngineDb.ts` 文件头注释。
 *
 * 这里的类型只描述"数据长什么样"，不包含任何读写数据库或随机数生成的逻辑——
 * 那些都在 `shared/game/engine/*.ts`（纯函数，可单元测试）和
 * `frontend/src/lib/gameEngineDb.ts`（数据库读写 + 乐观锁重试）里。
 */

/** 棋子颜色，对应棋盘四个颜色角（R 红 / G 绿 / B 蓝 / Y 黄） */
export type PlayerColor = 'R' | 'G' | 'B' | 'Y'

/**
 * 回合阶段状态机。
 *
 * - ROLLING：当前玩家需要掷骰（含"自然 6"触发的额外掷骰，用
 *   `extraRollPending` 区分，不单独建阶段）。
 * - LANDING：骰子已经掷出、棋子已经移动到最终位置，落点效果已经写入数据库；
 *   如果落点效果需要当前玩家做出选择（买地产/喝酒确认/真心话大冒险确认/
 *   规则待确认事件的"知道了"），`pendingDecision` 非空，必须先处理完
 *   才能继续；如果没有待处理的选择，当前玩家点"继续"直接进入下一阶段。
 * - LADY_CARD：必须翻 1 张小姐主牌（额外掷骰的落点不触发这一步）。
 * - TACTIC：可选：打 1 张战术牌或跳过，之后自动结束回合。
 */
export type TurnPhase = 'ROLLING' | 'LANDING' | 'LADY_CARD' | 'TACTIC'

/** 当前回合需要"当前玩家"（HOST_RULING / NATURAL_SIX_CHAIN / TAROT_JUSTICE 例外，见下）明确做出选择才能继续的事情 */
export type PendingDecision =
  | { kind: 'BUY_PROPERTY'; cellId: number; propertyName: string; price: number }
  | { kind: 'CHOOSE_DRINK_TARGET'; amount: number; reason: string }
  /** 两步：先选真心话/大冒险（choice 为 null 时），再确认"完成/拒绝" */
  | { kind: 'TRUTH_OR_DARE'; choice: 'TRUTH' | 'DARE' | null }
  /** 恋人塔罗：翻牌者指定两名玩家绑定 */
  | { kind: 'CHOOSE_LOVERS' }
  /** 正义塔罗：线下剪刀石头布后，由房主录入大众赢家和大众输家 */
  | { kind: 'TAROT_JUSTICE' }
  /** 规则书未写明具体结算方式的格子（停骰一次/发车任务/德州+1/下家禁骰等）：只能由房主现场裁定、点击"已处理" */
  | { kind: 'HOST_RULING'; description: string }
  /** 额外掷骰（自然6触发）本身又摇出自然6时是否继续连锁——规则书明确标注"待确认"，只能由房主裁定，不自动连锁 */
  | { kind: 'NATURAL_SIX_CHAIN' }

/**
 * 非阻塞的"待喝酒确认"队列——目标是当前玩家以外的人（上家/下家/被指定者/
 * 被撞者），不应该卡住正在进行的回合。受影响玩家可以随时在自己的界面里
 * 处理（已完成 / 以水代替 / 跳过，房主也可以代为确认），处理前后都不影响
 * 其他玩家继续游戏。
 */
export interface PendingDrinkAck {
  id: string
  targetUid: string
  amount: number
  /** 非"口"单位的惩罚（例如真心话大冒险拒绝的"半杯"），有值时界面显示它而不是 amount */
  amountText?: string
  reason: string
  createdAt: number
  /** 小姐牌 2 的陪喝提醒：它本身不会再触发陪喝，避免无限循环 */
  accompany?: boolean
  /** 小姐牌 A：这条提醒是从谁那里替喝转来的；转过一次就不能再转 */
  transferredFromUid?: string
  /** 小姐牌 A：持券人已发出替喝请求，等待被指定的人接受或拒绝 */
  substituteOffer?: { fromUid: string; toUid: string }
}

/** DEVIL：恶魔塔罗下被判 1 口时，改为付 1 金币并指定另一人喝 2 口 */
export type DrinkAckChoice = 'DONE' | 'WATER' | 'SKIP' | 'DEVIL'

/** 玩家在游戏内的状态（和大厅阶段的昵称/座位信息分开，见 GameRoomPlayer） */
export interface GamePlayerState {
  uid: string
  color: PlayerColor
  /** 棋盘格 id，对应 shared/game/board.ts 的 BOARD_CELLS 下标 */
  position: number
  coins: number
  /** 已拥有的地产名（propertyName，见 board.ts），不区分地产 id 和名称 */
  properties: string[]
  /** 三国杀战术手牌的卡牌实例 id 列表，上限 3 张 */
  tacticHand: string[]
  /** 开局身份牌 id，本轮只做展示，不接入任何游戏逻辑 */
  identityCardId: string
  /** 开局 2 张德州底牌，本轮只做展示，不接入德州扑克逻辑 */
  texasHoleCards: [string, string]
}

/** 一次移动的来源说明，用于历史记录和"自然 6"判断 */
export interface DiceRollRecord {
  natural: number
  /** 经当前世界塔罗修正后的实际移动步数（愚者/战车会改变它） */
  effective: number
  isNaturalSix: boolean
  /**
   * 这次掷骰是否给予额外掷骰。通常等于 isNaturalSix，但愚者塔罗下自然 6
   * 不给额外掷骰。旧版本存档没有这个字段，读取时由 normalizeGameState 补齐。
   */
  grantsExtraRoll: boolean
  /** 塔罗对这次掷骰的修正说明（无修正时为 null），给界面展示"结算前后的变化" */
  tarotNote: string | null
}

/** 事件历史记录——用于"最近事件"界面和刷新后回看发生了什么 */
export interface GameHistoryEntry {
  id: string
  at: number
  /** 面向玩家的中文摘要，直接展示，不需要客户端再拼文案 */
  message: string
  /** 这条记录的主角，界面显示为"昵称：message" */
  actorUid?: string
}

/** 德国心脏病触发后的待房主裁定记录（不能用 5 秒轮询公平判断抢答顺序） */
export interface PendingHeartAttack {
  id: string
  /** 触发的花色及其合计（可能同时有多种花色都是 5 的倍数） */
  triggeredSuits: { suit: 'S' | 'H' | 'D' | 'C'; count: number }[]
  /** 触发时最近 5 张主牌的快照，全桌看到同一个窗口 */
  windowCardIds: string[]
  /** 翻出这张牌的玩家 uid（翻牌人自己也可能是第一反应者） */
  revealedByUid: string
  createdAt: number
}

/** 正义塔罗交换记录：交换前两人的座位资产快照，界面展示"交换前 → 交换后" */
export interface JusticeSwapRecord {
  id: string
  winnerUid: string
  loserUid: string
  before: Record<string, { position: number; seatIndex: number; coins: number; tacticHand: string[] }>
  at: number
}

// ---------------------------------------------------------------------------
// 小姐主牌事件（Phase D.2）
// ---------------------------------------------------------------------------

export type LadyRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

/**
 * 本局的小姐牌规则集。
 * - official：只有已确认的牌（目前只有 K 国王传承）自动结算，其余牌继续交给房主裁定。
 * - candidate-preview：开发测试专用，候选规则也自动结算；只能在开发环境开局时选择。
 */
export type LadyRuleset = 'official' | 'candidate-preview'

/**
 * 一张小姐牌翻开后的事件步骤。
 * - START：线下小游戏等待开始（3 输入主题、4 咔嚓、5 开始报数）
 * - HOST_RESULT：等待房主录入线下结果
 * - LUCKY_ROLL：7 幸运七，等待翻牌者掷事件骰
 * - CHOOSE_TARGET：9 决斗，等待翻牌者选对手
 * - DUEL_ROLL：9 决斗，等待双方掷骰
 * - KING_PERFORM：K，新国王执行上一任留下的任务，等待房主确认
 * - KING_WRITE：K，国王给下一任留任务
 * - DONE：事件已结束
 */
export type LadyEventStep = 'START' | 'HOST_RESULT' | 'LUCKY_ROLL' | 'CHOOSE_TARGET' | 'DUEL_ROLL' | 'KING_PERFORM' | 'KING_WRITE' | 'DONE'

export interface DuelRound {
  actorRoll: number | null
  targetRoll: number | null
}

export interface LadyEventResult {
  /** 输家（收到喝酒提醒的人）；可以为空 */
  loserUids: string[]
  /** 面向玩家的一句话结果 */
  summary: string
}

/** 统一的小姐牌事件记录：所有牌共用这一个形状，按 rank 走不同的步骤 */
export interface LadyEvent {
  eventId: string
  cardId: string
  rank: LadyRank
  /** 翻牌者 */
  actingUid: string
  step: LadyEventStep
  /** 需要参与/被影响的玩家 */
  participants: string[]
  /** 9 决斗的对手 */
  targetUid: string | null
  /** 3 的主题 / K 正在执行的任务内容 */
  text: string | null
  /** 4 照相机开始定格的时间（倒计时只是提示） */
  startedAt: number | null
  /** 7 幸运七的事件骰 */
  rolls: number[]
  duelRounds: DuelRound[]
  result: LadyEventResult | null
  status: 'ACTIVE' | 'RESOLVED'
  createdAt: number
  createdAtTurn: number
}

/** K 国王传承：上一任国王留给下一任的任务 */
export interface KingTask {
  taskId: string
  content: string
  creatorUid: string
  createdAtTurn: number
  /** PENDING 等待下一任国王；IN_PROGRESS 已被接收；COMPLETED / SKIPPED 已处理 */
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
  receiverUid: string | null
  resolvedAtTurn: number | null
}

export interface AwayRecord {
  uid: string
  since: number
  /** 是否使用了 8 的暂离通行证（暂离期间不能被选为决斗对手或小游戏输家） */
  withPass: boolean
}

/** 小姐牌带来的持续状态 */
export interface LadyStatus {
  /** 2：当前小姐 */
  mistressUid: string | null
  /** 10：当前神经病 */
  crazyUid: string | null
  /** K：最近一任国王 */
  kingUid: string | null
  /** A：持有替喝机会的玩家（每人最多 1 次） */
  substitutePassUids: string[]
  /** 8：持有暂离通行证的玩家（每人最多 1 张） */
  awayPassUids: string[]
  away: AwayRecord[]
}

/** 当前回合的瞬时状态（掷骰、移动链路、本回合是否已经翻过主牌等） */
export interface TurnState {
  phase: TurnPhase
  currentPlayerUid: string
  lastRoll: DiceRollRecord | null
  /** 自然 6 触发的额外掷骰：true 表示这一次掷骰的落点不触发翻主牌 */
  extraRollPending: boolean
  /** 本回合是否已经完成额外掷骰（用于"是否继续连锁"的待确认处理，详见 engine/movement.ts） */
  extraRollUsed: boolean
  pendingDecision: PendingDecision | null
  /** 本回合翻到的主牌 id，LADY_CARD 阶段完成后才会写入，TACTIC 阶段展示用 */
  revealedLadyCardId: string | null
  /**
   * 当前这一次掷骰的落点效果是否已经结算过——LANDING 阶段可能因为
   * `pendingDecision` 停留很久（等待玩家确认买地产/喝酒/真心话大冒险），
   * 如果没有这个标记，重复点击"结算落点"或者轮询重试会把移动、金币、
   * 买地产弹窗等效果重复触发一遍。见 engine/turnEngine.ts 的
   * applyResolveLanding 实现。
   */
  landingResolved: boolean
  /** 本回合已经打出过战术牌的玩家（含响应时打出的桃）——魔术师塔罗"每名玩家每回合第一次出牌后补抽"用 */
  playersWhoPlayedTacticThisTurn: string[]
  /** 本回合世界塔罗改变了哪些结算（"战车：移动 +1（3 → 4）"），界面展示结算前后的变化 */
  tarotNotes: string[]
  /** 规则书"可选：打 1 张三国杀手牌；响应牌不限"——本回合是否已经主动出过牌 */
  activeTacticUsed: boolean
}

/** 当前塔罗附带的状态；新塔罗生效时整体重置，旧塔罗的持续效果随之失效 */
export interface TarotState {
  /** 恋人塔罗绑定的两名玩家 */
  loversPair: [string, string] | null
}

/** 塔罗即时效果对某位玩家（或全桌，uid 为 null）的结算结果 */
export interface TarotEffectLine {
  uid: string | null
  text: string
}

/** 最近一次世界塔罗更换——所有客户端据此播放一次全屏揭示动画（按 id 去重） */
export interface TarotChangeEvent {
  id: string
  tarotId: string
  previousTarotId: string | null
  /** 触发更换的玩家（开局摆放的塔罗为 null） */
  triggeredByUid: string | null
  at: number
  summary: TarotEffectLine[]
}

export interface GameState {
  /** 游戏初始化时间戳，仅用于展示/调试 */
  startedAt: number
  /** 固定的玩家顺序（等于开局时 GameRoomPlayer 按座位排序后的 uid 列表） */
  turnOrder: string[]
  currentPlayerIndex: number
  /** 第几回合（从 1 开始，每次 applyEndTurn 时 +1），仅用于 HUD 展示 */
  turnNumber: number
  players: Record<string, GamePlayerState>
  turn: TurnState
  pendingDrinkAcks: PendingDrinkAck[]
  /** 最近 5 张翻开的小姐主牌实例 id（如 "H-7"），德国心脏病窗口，新的追加到末尾 */
  recentLadyCards: string[]
  /** 主牌牌堆（洗好的 52 张，抽牌从头部取） */
  ladyDeck: string[]
  /** 已经翻开过的主牌；牌堆抽完时，不在窗口里的牌洗回牌堆 */
  ladyDiscard: string[]
  pendingHeartAttack: PendingHeartAttack | null
  lastJusticeSwap: JusticeSwapRecord | null
  /** 当前生效的世界塔罗 id，持续效果在各结算点实时读取（见 engine/tarotEffects.ts） */
  currentTarotId: string
  tarotState: TarotState
  lastTarotChange: TarotChangeEvent | null
  /** 死神塔罗：还需要弃 1 张手牌的玩家（非阻塞，本人或房主处理） */
  pendingTarotDiscards: string[]
  /** 本局小姐牌规则集；旧房间读取时补为 official */
  ladyRuleset: LadyRuleset
  /** 本回合翻开的小姐牌事件；结束回合时清空 */
  ladyEvent: LadyEvent | null
  ladyStatus: LadyStatus
  /** K：等待下一任国王的任务（同一时间最多一条） */
  kingTask: KingTask | null
  /** K：已经处理过的任务（最近 10 条） */
  kingTaskHistory: KingTask[]
  history: GameHistoryEntry[]
  /** 游戏是否已经结束（本轮终点/结算逻辑未实现，恒为 false，字段先占位） */
  finished: boolean
}
