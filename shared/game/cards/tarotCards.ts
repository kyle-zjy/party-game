/**
 * 22 张世界塔罗（V1.5 规则书第三部分），文案逐字保留原稿。
 * 持续效果的结算在 engine/tarotEffects.ts，即时效果在 engine/tarotActions.ts。
 * 每张牌的实现状态见 docs/rule-implementation-matrix.md。
 */
import type { TarotCardDef } from './types'

export const TAROT_CARDS: TarotCardDef[] = [
  { id: 'tarot-0', romanNumeral: '0', name: '愚者', nameEn: 'The Fool', effectTiming: 'continuous', description: '自然掷出 1 时按 6 移动；自然掷出 6 时只按 1 移动且不获得额外掷骰。' },
  { id: 'tarot-1', romanNumeral: 'I', name: '魔术师', nameEn: 'The Magician', effectTiming: 'continuous', description: '每名玩家每回合第一次打出三国杀手牌后，从牌堆补抽 1 张（手牌上限 3）。' },
  { id: 'tarot-2', romanNumeral: 'II', name: '女祭司', nameEn: 'The High Priestess', effectTiming: 'continuous', description: '真心话大冒险格只能选择"真心话"；完成回答后从银行得 1 金币。' },
  { id: 'tarot-3', romanNumeral: 'III', name: '皇后', nameEn: 'The Empress', effectTiming: 'continuous', description: '完成任何真心话或大冒险后，从银行得 1 金币。' },
  { id: 'tarot-4', romanNumeral: 'IV', name: '皇帝', nameEn: 'The Emperor', effectTiming: 'continuous', description: '集齐同色 3 处地产时，该色租金为 3 金币而不是 2 金币。' },
  { id: 'tarot-5', romanNumeral: 'V', name: '教皇', nameEn: 'The Hierophant', effectTiming: 'continuous', description: '抓到其他玩家违规时，抓到者获得 2 金币。' },
  { id: 'tarot-6', romanNumeral: 'VI', name: '恋人', nameEn: 'The Lovers', effectTiming: 'instant+continuous', description: '翻牌者指定两名玩家"绑定"。在此塔罗有效期间，两人中每人从银行获得金币时，另一人也得 1 金币。' },
  { id: 'tarot-7', romanNumeral: 'VII', name: '战车', nameEn: 'The Chariot', effectTiming: 'continuous', description: '所有移动骰结果 +1，最大仍为 6；只有"自然掷出 6"才触发额外掷骰。' },
  { id: 'tarot-8', romanNumeral: 'VIII', name: '力量', nameEn: 'Strength', effectTiming: 'continuous', description: '碰撞回原点变为退 3 格，原退 3 格变为退 1 格（不叠加）。' },
  { id: 'tarot-9', romanNumeral: 'IX', name: '隐者', nameEn: 'The Hermit', effectTiming: 'continuous', description: '若你回合开始时独自占据一个格子，从银行得 1 金币。' },
  { id: 'tarot-10', romanNumeral: 'X', name: '命运之轮', nameEn: 'Wheel of Fortune', effectTiming: 'instant', description: '换手牌判定——1、2 顺时针换，3、4 对家换，5、6 逆时针换。' },
  { id: 'tarot-11', romanNumeral: 'XI', name: '正义', nameEn: 'Justice', effectTiming: 'instant', description: '依次剪刀石头布，大众赢家和大众输家交换座位（继承全部手牌和金币，德扑和地产不继承）。' },
  { id: 'tarot-12', romanNumeral: 'XII', name: '倒吊人', nameEn: 'The Hanged Man', effectTiming: 'continuous', description: '真心话大冒险格只能选择"大冒险"；完成回答后从银行得 1 金币。' },
  { id: 'tarot-13', romanNumeral: 'XIII', name: '死神', nameEn: 'Death', effectTiming: 'instant', description: '每人弃 1 张手牌（没有则罚 1 口）。' },
  { id: 'tarot-14', romanNumeral: 'XIV', name: '节制', nameEn: 'Temperance', effectTiming: 'continuous', description: '所有"挡酒/免罚"效果暂时失效。' },
  { id: 'tarot-15', romanNumeral: 'XV', name: '恶魔', nameEn: 'The Devil', effectTiming: 'continuous', description: '玩家被判 1 口时，可改为向银行支付 1 金币并指定另一人 2 口。' },
  { id: 'tarot-16', romanNumeral: 'XVI', name: '高塔', nameEn: 'The Tower', effectTiming: 'continuous', description: '所有地产暂停收租。' },
  { id: 'tarot-17', romanNumeral: 'XVII', name: '星星', nameEn: 'The Star', effectTiming: 'continuous', description: '德国心脏病正确第一反应者改为获得 2 金币。' },
  { id: 'tarot-18', romanNumeral: 'XVIII', name: '月亮', nameEn: 'The Moon', effectTiming: 'continuous', description: '骗子酒馆发生质疑时，质疑胜者额外从银行得 1 金币。' },
  { id: 'tarot-19', romanNumeral: 'XIX', name: '太阳', nameEn: 'The Sun', effectTiming: 'continuous', description: '经过起点时改为获得 3 金币。' },
  { id: 'tarot-20', romanNumeral: 'XX', name: '审判', nameEn: 'Judgement', effectTiming: 'instant', description: '所有战术牌数量 ≤1 的玩家抽 1 张战术牌；所有金币 ≤1 的玩家从银行得 1 金币。' },
  { id: 'tarot-21', romanNumeral: 'XXI', name: '世界', nameEn: 'The World', effectTiming: 'continuous', description: '所有"前进 4 格"改为"前进 6 格"。' },
]

export function getTarotCard(id: string): TarotCardDef {
  const card = TAROT_CARDS.find((c) => c.id === id)
  if (!card) throw new Error(`未知的塔罗 id：${id}`)
  return card
}

/** 抽一张塔罗；更换时排除当前这张，保证真的换了一张 */
export function drawRandomTarotId(excludeId?: string, rng: () => number = Math.random): string {
  const pool = excludeId ? TAROT_CARDS.filter((c) => c.id !== excludeId) : TAROT_CARDS
  const idx = Math.floor(rng() * pool.length)
  const card = pool[idx]
  if (!card) throw new Error('塔罗牌堆为空，不应该发生')
  return card.id
}
