/**
 * 阿瓦隆任务定义（V1.5 规则书第七部分）。
 *
 * 已明确的规则：触发者为车主，车主挑选本车乘客后匿名投票；好人只能投"同意"，
 * 坏人可投"同意"或"不同意"；出现 1 张 FAIL 即发车失败；先到 3 次成功/失败
 * 结算：胜方每人金币 +1，败方每人喝 1 口。
 *
 * 【未定稿，不编造】规则书原文没有给出 3–10 人各人数对应的"每车乘客数"表，
 * 也没有给出阵营人数配置（见 `identityCards.ts`）。本文件只记录"已知为真"
 * 的流程常量，`MISSION_SIZE_BY_PLAYER_COUNT` 明确留空（`undefined`），
 * 引擎遇到发车任务格子时会产出 `HOST_RULING`，不会从这里凭空取一个猜测值。
 */

export const AVALON_SUCCESS_TARGET = 3
export const AVALON_FAIL_TARGET = 3
export const AVALON_WIN_COIN_REWARD = 1
export const AVALON_LOSE_DRINK_PENALTY = 1

/** 3–10 人分别对应的每车乘客数——规则书未给出，故意留空，不补造数值 */
export const MISSION_SIZE_BY_PLAYER_COUNT: Partial<Record<number, number>> = {}

export function getMissionSize(playerCount: number): number | undefined {
  return MISSION_SIZE_BY_PLAYER_COUNT[playerCount]
}
