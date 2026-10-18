import { useState } from 'react'
import { QUICK_START_STEPS, WELCOME_LINE } from '../tutorial/tutorialLines'
import { HostAvatar } from './HostAvatar'

/** 第一次开局的 30 秒快速教学——用户需求明确点："允许跳过教学"+"本地记录是否已看过" */
export function QuickStartOverlay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(-1) // -1 = 欢迎语

  const isWelcome = step === -1
  const current = isWelcome ? WELCOME_LINE : QUICK_START_STEPS[step]
  const isLast = step === QUICK_START_STEPS.length - 1

  return (
    <div className="mg-scrim" role="dialog" aria-modal="true">
      <div className="mg-sheet mg-quickstart-sheet">
        <div className="mg-quickstart-avatar">
          <HostAvatar size={56} />
        </div>
        <p className="mg-display mg-quickstart-title">今晚的主持人说</p>
        <p className="mg-quickstart-message">{current?.message}</p>
        {isWelcome && current?.detail && <p className="mg-muted" style={{ marginTop: 8 }}>{current.detail}</p>}

        <div className="mg-quickstart-dots">
          {Array.from({ length: QUICK_START_STEPS.length + 1 }).map((_, i) => (
            <span key={i} className={`mg-quickstart-dot${i === step + 1 ? ' mg-quickstart-dot-active' : ''}`} />
          ))}
        </div>

        <div className="mg-action-row" style={{ marginTop: 16 }}>
          <button type="button" className="mg-btn mg-btn-ghost" onClick={onDone}>
            跳过教学
          </button>
          <button
            type="button"
            className="mg-btn mg-btn-gold"
            onClick={() => {
              if (isLast || (isWelcome && QUICK_START_STEPS.length === 0)) onDone()
              else setStep(step + 1)
            }}
          >
            {isLast ? '开始游戏' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
