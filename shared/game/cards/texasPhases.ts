/**
 * 德州扑克 / CASINO 阶段定义（V1.5 规则书"6. 德州扑克"）。
 *
 * 已明确：开局每人 2 张底牌；CASINO 第 1 次翻 Flop（3 张），第 2 次 Turn，
 * 第 3 次 River 并摊牌；每阶段最多 1 金币加注；每个德州手牌周期每人可吹牛
 * 一次（声明"我有 X"，无人质疑则免，质疑后有 X 则质疑者 1 口，无 X 则
 * 原惩罚 + 额外 1 口）。
 *
 * 本轮不实现推进这些阶段的引擎逻辑（见 `texasCards.ts` 文件头说明）——
 * 这里先把阶段名称和数值常量数据化，方便后续阶段直接复用，不需要重新
 * 对照规则书。
 */
export type TexasPhase = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN'

export const TEXAS_PHASE_ORDER: TexasPhase[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN']

export const TEXAS_PHASE_LABEL: Record<TexasPhase, string> = {
  PREFLOP: '翻牌前',
  FLOP: 'Flop（公共牌 3 张）',
  TURN: 'Turn（公共牌第 4 张）',
  RIVER: 'River（公共牌第 5 张，摊牌）',
  SHOWDOWN: '摊牌结算',
}

export const TEXAS_MAX_RAISE_PER_PHASE = 1

export const HAND_RANKING_HIGH_TO_LOW = ['豹子', '同花顺', '同花', '顺子', '对子', '单张'] as const
