/**
 * V1.6 数字版：真心话 / 大冒险题库（原稿用线下 truth or dare 牌，数字版内置一套可维护的题库）。
 *
 * 编写原则：自愿、轻量、聚会友好。不要求泄露隐私（收入、密码、住址、性经历等），
 * 不要求危险动作、强制饮酒或未经同意的身体接触。房主可以随时换一题，玩家也可以选择"不做/不答"按原规则结算。
 * 新增题目直接在数组末尾追加；id 不要复用，已经抽到的题会按 id 记录在房间里。
 */
export interface TruthOrDarePrompt {
  id: string
  kind: 'TRUTH' | 'DARE'
  text: string
}

export const TRUTH_PROMPTS: TruthOrDarePrompt[] = [
  { id: 't01', kind: 'TRUTH', text: '你最近一次被逗笑到停不下来是因为什么？' },
  { id: 't02', kind: 'TRUTH', text: '你小时候最想长大后做什么职业？' },
  { id: 't03', kind: 'TRUTH', text: '你手机里最常听的一首歌是什么？' },
  { id: 't04', kind: 'TRUTH', text: '你做过最"社死"但现在想起来很好笑的事是什么？' },
  { id: 't05', kind: 'TRUTH', text: '如果明天放假一周，你最想去哪里？' },
  { id: 't06', kind: 'TRUTH', text: '在座的人里，你觉得谁最适合一起参加综艺？为什么？' },
  { id: 't07', kind: 'TRUTH', text: '你最近一次熬夜是在干什么？' },
  { id: 't08', kind: 'TRUTH', text: '你有什么一直想学但还没开始的技能？' },
  { id: 't09', kind: 'TRUTH', text: '你吃过最奇怪的食物组合是什么？' },
  { id: 't10', kind: 'TRUTH', text: '你第一次见到在座某个人时的第一印象是什么？（可以挑一个人说）' },
  { id: 't11', kind: 'TRUTH', text: '你最喜欢的一部电影或剧是什么？推荐一句理由。' },
  { id: 't12', kind: 'TRUTH', text: '你最怕的小动物或小虫子是什么？' },
  { id: 't13', kind: 'TRUTH', text: '如果可以拥有一种超能力，你选什么？' },
  { id: 't14', kind: 'TRUTH', text: '你最近一次说"下次一定"是关于什么？' },
  { id: 't15', kind: 'TRUTH', text: '你觉得自己身上最被低估的优点是什么？' },
]

export const DARE_PROMPTS: TruthOrDarePrompt[] = [
  { id: 'd01', kind: 'DARE', text: '用播音腔念一遍你手机里最近一条通知的标题（可以挑一条无隐私的）。' },
  { id: 'd02', kind: 'DARE', text: '模仿一种动物叫三声，让大家猜是什么。' },
  { id: 'd03', kind: 'DARE', text: '用三种不同的语气说"今夜别想下桌"。' },
  { id: 'd04', kind: 'DARE', text: '给在座的每个人起一个可爱的外号（大家同意才算数）。' },
  { id: 'd05', kind: 'DARE', text: '保持一个搞怪表情 10 秒，让大家拍照（不想被拍可以只看）。' },
  { id: 'd06', kind: 'DARE', text: '唱一句你最近单曲循环的歌。' },
  { id: 'd07', kind: 'DARE', text: '用方言说一句祝酒词（喝不喝随意）。' },
  { id: 'd08', kind: 'DARE', text: '表演一段 15 秒的默剧，让大家猜你在做什么。' },
  { id: 'd09', kind: 'DARE', text: '夸一下你右手边的人，至少说三个优点。' },
  { id: 'd10', kind: 'DARE', text: '用"今晚"开头即兴编一句押韵的话。' },
  { id: 'd11', kind: 'DARE', text: '倒着说出你的名字，再说一遍你最喜欢的食物。' },
  { id: 'd12', kind: 'DARE', text: '学一个在座朋友的口头禅（对方同意才学）。' },
  { id: 'd13', kind: 'DARE', text: '做一个 10 秒的广告，推销桌上的一样东西。' },
  { id: 'd14', kind: 'DARE', text: '用歌剧腔宣布下一位玩家的名字。' },
  { id: 'd15', kind: 'DARE', text: '摆一个你觉得最帅/最美的姿势，保持 5 秒。' },
]

export function promptsFor(kind: 'TRUTH' | 'DARE'): TruthOrDarePrompt[] {
  return kind === 'TRUTH' ? TRUTH_PROMPTS : DARE_PROMPTS
}

/** 抽一题：优先抽本局还没用过的；全部用过后重新开始 */
export function drawPrompt(kind: 'TRUTH' | 'DARE', usedIds: string[], rng: () => number): TruthOrDarePrompt {
  const all = promptsFor(kind)
  const fresh = all.filter((p) => !usedIds.includes(p.id))
  const pool = fresh.length > 0 ? fresh : all
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!
}

export function getPrompt(id: string): TruthOrDarePrompt | undefined {
  return [...TRUTH_PROMPTS, ...DARE_PROMPTS].find((p) => p.id === id)
}
