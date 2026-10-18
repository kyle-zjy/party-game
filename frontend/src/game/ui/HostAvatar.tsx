/** "今晚的主持人"的自绘 SVG 头像——酒馆说书人剪影，避免用 emoji 充当主要 UI 图标 */
export function HostAvatar({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="url(#mg-host-grad)" stroke="var(--mg-gold, #f2c46c)" strokeWidth="1.5" />
      <defs>
        <radialGradient id="mg-host-grad" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#3a2a66" />
          <stop offset="100%" stopColor="#1a1430" />
        </radialGradient>
      </defs>
      {/* 兜帽剪影 */}
      <path
        d="M24 10c-7 0-12 5.5-12 13v6c0 1.5 1 2.5 2.5 2.5h19c1.5 0 2.5-1 2.5-2.5v-6c0-7.5-5-13-12-13z"
        fill="#241c3d"
      />
      {/* 三角铃铛（小丑/说书人意象） */}
      <circle cx="16" cy="13" r="2" fill="var(--mg-gold, #f2c46c)" />
      <circle cx="32" cy="13" r="2" fill="var(--mg-coral, #ff607c)" />
      <circle cx="24" cy="8" r="2" fill="var(--mg-teal, #48d8cc)" />
      {/* 眼睛 */}
      <circle cx="19" cy="25" r="1.6" fill="var(--mg-gold, #f2c46c)" />
      <circle cx="29" cy="25" r="1.6" fill="var(--mg-gold, #f2c46c)" />
      {/* 笑容 */}
      <path d="M18 30c2 2 10 2 12 0" stroke="var(--mg-gold, #f2c46c)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}
