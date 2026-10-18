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

/** 当前回合需要"当前玩家"（HOST_RULING / NATURAL_SIX_CHAIN 例外，见下）明确做出选择才能继续的事情 */
export type PendingDecision =
  | { kind: 'BUY_PROPERTY'; cellId: number; propertyName: string; price: number }
  | { kind: 'DRINK_ACK'; amount: number; reason: string }
  | { kind: 'CHOOSE_DRINK_TARGET'; amount: number; reason: string }
  | { kind: 'TRUTH_OR_DARE' }
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
  reason: string
  createdAt: number
}

export type DrinkAckChoice = 'DONE' | 'WATER' | 'SKIP'

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
  /** 当前世界塔罗对骰子的修正（本轮未接入任何塔罗效果，恒等于 natural） */
  effective: number
  isNaturalSix: boolean
}

/** 事件历史记录——用于"最近事件"界面和刷新后回看发生了什么 */
export interface GameHistoryEntry {
  id: string
  at: number
  /** 面向玩家的中文摘要，直接展示，不需要客户端再拼文案 */
  message: string
}

/** 德国心脏病触发后的待房主裁定记录（不能用 5 秒轮询公平判断抢答顺序） */
export interface PendingHeartAttack {
  id: string
  suitLabel: string
  count: number
  /** 触发这次翻牌的玩家 uid（翻牌人自己也可能是第一反应者） */
  revealedByUid: string
  createdAt: number
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
  /** 最近 5 张翻开的小姐主牌 id（用于德国心脏病窗口判断），新的追加到末尾 */
  recentLadyCards: string[]
  pendingHeartAttack: PendingHeartAttack | null
  /** 当前生效的世界塔罗 id；本轮只展示，不接入任何塔罗持续效果的实际结算 */
  currentTarotId: string
  history: GameHistoryEntry[]
  /** 游戏是否已经结束（本轮终点/结算逻辑未实现，恒为 false，字段先占位） */
  finished: boolean
}
