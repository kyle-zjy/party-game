/**
 * 小姐主牌 A–K 的牌名与德国心脏病数量（V1.5 原稿第二部分 + 第 4 节）。
 *
 * 原稿 13 张牌的备注全部是"〔原稿无详细说明〕"，5 和 7 连牌名都是空白；K 多一句"指定下一位'国王'做什么"。
 *
 * 规则状态（Phase D.2）：
 * - K 国王传承：用户已正式确认（ruleStatus 'confirmed'），正式对局自动结算。
 * - 其余 12 张：只有候选方案（`candidate`），ruleStatus 仍为 'pending'。正式对局翻到它们仍交给房主裁定；
 *   只有开发环境开局时选择"候选规则预览"的房间才会按候选方案结算（见 engine/ladyEvents.ts 的 isLadyRuleActive）。
 *
 * 牌堆、花色和心脏病判定见 ladyDeck.ts。
 */
import type { LadyCardDef } from './types'

const HOST_RULING = '牌义待确认（原稿只有牌名），请房主现场裁定'

export const LADY_CARDS: LadyCardDef[] = [
  {
    id: 'lady-A',
    rank: 'A',
    name: '替我喝',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 1,
    candidate: {
      name: '替我喝',
      rule: '翻牌者获得 1 次替喝机会（每人最多持有 1 次）。之后自己收到"口"为单位的喝酒提醒时，可以请另一名玩家代喝；对方可以拒绝。对方接受后提醒转给对方，机会用掉；被转过的提醒不能再转。半杯惩罚不适用。',
      guide: ['获得替喝机会！', '之后收到喝酒提醒时，点"请人替喝"并选择一名玩家。', '对方可以接受或拒绝；接受后提醒转给对方，替喝机会用掉。'],
    },
  },
  {
    id: 'lady-2',
    rank: '2',
    name: '小姐牌',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 2,
    candidate: {
      name: '小姐牌',
      rule: '翻牌者成为本桌当前小姐，直到下一张 2 出现。其他玩家收到喝酒提醒时，小姐额外收到 1 条陪喝提醒；同一次事件最多陪 1 次；小姐自己在这次事件里已经要喝时不再陪；陪喝提醒不会再触发陪喝。',
      guide: ['你成为本桌小姐！', '从现在起，别人被罚喝酒时你会收到一条陪喝提醒。', '下一张 2 出现时由新小姐接任。'],
    },
  },
  {
    id: 'lady-3',
    rank: '3',
    name: '逛三园',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 3,
    candidate: {
      name: '逛三园',
      rule: '翻牌者选一个主题（如动物园、水果园）。从翻牌者的下家开始按行动顺序轮流说一个属于该主题的词；重复、答错或约 5 秒答不上的人失败。房主确认第一位失败者，失败者收到 1 口喝酒提醒。',
      guide: ['今晚我们来逛三园！', '请翻牌者选择主题。', '从下家开始轮流回答。', '房主确认第一位失败者。', '游戏自动进入下一阶段。'],
    },
  },
  {
    id: 'lady-4',
    rank: '4',
    name: '照相机',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 4,
    candidate: {
      name: '照相机',
      rule: '翻牌者点"咔嚓"，全桌进入约 10 秒定格挑战，翻牌者可以逗大家。第一个移动或笑出声的人失败，收到 1 口喝酒提醒。倒计时只是提示，结果由房主确认；没人失败就直接完成。',
      guide: ['照相机！', '翻牌者点"咔嚓"，全桌保持不动。', '第一个动或笑出声的人失败。', '房主确认结果（也可以是"没人动"）。'],
    },
  },
  {
    id: 'lady-5',
    rank: '5',
    name: '〔空白〕',
    description: '原稿牌名和牌义都是空白，请房主现场裁定',
    ruleStatus: 'pending',
    heartAttackCount: 5,
    candidate: {
      name: '数五',
      rule: '（原稿空白，候选方案）从翻牌者开始按行动顺序从 1 轮流报数，遇到 5 的倍数要拍桌子、不能说数字。报错、漏拍或停顿过久的人失败，收到 1 口喝酒提醒；报到 30 没人出错则全员成功。房主确认输家。',
      guide: ['数五！', '从翻牌者开始报"1"，按行动顺序轮流报数。', '5、10、15……要拍桌子，不能说出来。', '房主确认失败者，或者报到 30 没人出错。'],
    },
  },
  {
    id: 'lady-6',
    rank: '6',
    name: '干杯',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 1,
    candidate: {
      name: '干杯',
      rule: '全桌（包括翻牌者）每人收到 1 条 1 口的干杯提醒。提醒不阻塞回合，各自确认；可以以水代替或跳过。',
      guide: ['干杯！', '每个人都收到一条干杯提醒，各自确认即可。', '回合直接继续，不用等所有人喝完。'],
    },
  },
  {
    id: 'lady-7',
    rank: '7',
    name: '〔空白〕',
    description: '原稿牌名和牌义都是空白，请房主现场裁定',
    ruleStatus: 'pending',
    heartAttackCount: 2,
    candidate: {
      name: '幸运七',
      rule: '（原稿空白，候选方案）翻牌者掷一次事件骰：自然 6 从银行得 2 金币；自然 1 收到 1 口喝酒提醒；其他点数无事发生。事件骰不是移动骰：不移动、不触发额外掷骰，也不受愚者/战车修正。',
      guide: ['幸运七！', '翻牌者掷一次事件骰。', '6 点得 2 金币，1 点喝 1 口，其他点数无事。'],
    },
  },
  {
    id: 'lady-8',
    rank: '8',
    name: '厕所牌',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 3,
    candidate: {
      name: '暂离通行证',
      rule: '翻牌者获得 1 张暂离通行证（每人最多 1 张）。任何人随时都可以离席、标记"暂离"，不会受罚；使用通行证暂离时，暂离期间不会被选为决斗对手或小游戏输家。暂离不会跳过任何人的回合，轮到暂离玩家时等 TA 回来（房主可以代为处理喝酒提醒）。不能买卖。',
      guide: ['获得暂离通行证！', '想离席时点"暂离"，可以选择使用通行证。', '回来后点"我回来了"。没有通行证也可以随时离席，不会受罚。'],
    },
  },
  {
    id: 'lady-9',
    rank: '9',
    name: '决斗',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 4,
    candidate: {
      name: '决斗',
      rule: '翻牌者选一名其他玩家，双方各掷一颗 d6，点数小的失败，收到 1 口喝酒提醒。平局重掷，最多 3 轮；3 轮都平局则无人失败。骰子由系统掷出并写入共享状态，不受愚者/战车修正。',
      guide: ['决斗！', '翻牌者选择对手。', '双方各自点"掷骰"。', '点数小的一方喝 1 口；平局重掷，最多 3 轮。'],
    },
  },
  {
    id: 'lady-10',
    rank: '10',
    name: '神经病',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 5,
    candidate: {
      name: '神经病',
      rule: '翻牌者成为当前神经病，直到下一张 10 出现。神经病可以故意找人闲聊，其他人回应了就算上当，由房主记录，上当者收到 1 口喝酒提醒。正常的游戏操作沟通（如"轮到你了"）不算。和"不能说为什么"禁令同时违反时，房主分别录入，系统不会自动重复处罚。',
      guide: ['你成为神经病！', '其他人不要回应神经病的闲聊。', '有人上当时，房主点"神经病：记录上当"。', '下一张 10 出现时解除。'],
    },
  },
  {
    id: 'lady-J',
    rank: 'J',
    name: '左边喝',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 1,
    candidate: {
      name: '左边喝',
      rule: '翻牌者左边的玩家收到 1 口喝酒提醒。左边 = 上家（行动顺序的前一位）。正义塔罗交换座位时行动顺序随之交换，所以始终按当前行动顺序计算。',
      guide: ['左边喝！', '翻牌者的上家收到一条喝酒提醒。', '回合直接继续。'],
    },
  },
  {
    id: 'lady-Q',
    rank: 'Q',
    name: '右边喝',
    description: HOST_RULING,
    ruleStatus: 'pending',
    heartAttackCount: 2,
    candidate: {
      name: '右边喝',
      rule: '翻牌者右边的玩家收到 1 口喝酒提醒。右边 = 下家（行动顺序的后一位），始终按当前行动顺序计算。',
      guide: ['右边喝！', '翻牌者的下家收到一条喝酒提醒。', '回合直接继续。'],
    },
  },
  {
    id: 'lady-K',
    rank: 'K',
    name: '国王牌',
    description:
      '国王传承（已确认）：翻到 K 的人成为新国王。上一任国王留下了任务时，新国王先执行（房主确认完成，也可以跳过，跳过不扣金币、不罚酒）；然后新国王给下一任国王留下一条新任务。第一任国王没有任务要执行，直接留任务。',
    ruleStatus: 'confirmed',
    heartAttackCount: 3,
  },
]

export const KING_GUIDE = {
  first: '恭喜成为第一任国王！请留下一个给下一位国王的挑战。',
  received: '上一任国王给你留下了一个挑战！',
  perform: '完成或跳过挑战。',
  write: '现在轮到你为下一任国王留下任务。',
}

/** 接受带花色的实例 id（"H-7"）或旧版点数 id（"lady-7"） */
export function getLadyCard(id: string): LadyCardDef {
  const rank = id.startsWith('lady-') ? id.slice(5) : id.split('-')[1]
  const card = LADY_CARDS.find((c) => c.rank === rank)
  if (!card) throw new Error(`未知的小姐主牌 id：${id}`)
  return card
}
