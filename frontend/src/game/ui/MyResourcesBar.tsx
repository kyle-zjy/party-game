import { useEffect, useRef, useState } from 'react'
import type { GamePlayerState } from '../../../../shared/game/types'

/** 数字变化时短暂加一个金色脉冲类名，满足"金币/地产/手牌变化要有视觉反馈"的要求，不依赖额外动画库 */
function usePulseOnChange(value: number): boolean {
  const prevRef = useRef(value)
  const [pulsing, setPulsing] = useState(false)
  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value
      setPulsing(true)
      const t = setTimeout(() => setPulsing(false), 500)
      return () => clearTimeout(t)
    }
    return undefined
  }, [value])
  return pulsing
}

export function MyResourcesBar({
  me,
  onOpenProperties,
  onOpenHand,
}: {
  me: GamePlayerState
  onOpenProperties: () => void
  onOpenHand: () => void
}) {
  const coinsPulsing = usePulseOnChange(me.coins)
  const propertiesPulsing = usePulseOnChange(me.properties.length)
  const handPulsing = usePulseOnChange(me.tacticHand.length)

  return (
    <div className="mg-resources">
      <div className={`mg-resource-item mg-resource-coins${coinsPulsing ? ' mg-resource-pulse' : ''}`}>
        <CoinIcon />
        <span className="mg-number mg-resource-value">{me.coins}</span>
      </div>
      <button
        type="button"
        className={`mg-resource-item mg-resource-btn${propertiesPulsing ? ' mg-resource-pulse' : ''}`}
        onClick={onOpenProperties}
      >
        <PropertyIcon />
        <span className="mg-number mg-resource-value">{me.properties.length}</span>
      </button>
      <button
        type="button"
        className={`mg-resource-item mg-resource-btn${handPulsing ? ' mg-resource-pulse' : ''}`}
        onClick={onOpenHand}
      >
        <CardIcon />
        <span className="mg-number mg-resource-value">{me.tacticHand.length}</span>
      </button>
    </div>
  )
}

export function CoinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="var(--mg-gold, #f2c46c)" stroke="#8a650f" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="#8a650f" strokeWidth="1" />
      <text x="12" y="16" textAnchor="middle" fontSize="9" fill="#8a650f" fontWeight="700">
        $
      </text>
    </svg>
  )
}

function PropertyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11L12 4l8 7" stroke="var(--mg-teal, #48d8cc)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <rect x="6" y="11" width="12" height="9" fill="none" stroke="var(--mg-teal, #48d8cc)" strokeWidth="1.6" />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="18" rx="2" fill="none" stroke="var(--mg-coral, #ff607c)" strokeWidth="1.6" />
      <line x1="8" y1="9" x2="16" y2="9" stroke="var(--mg-coral, #ff607c)" strokeWidth="1.2" />
      <line x1="8" y1="13" x2="16" y2="13" stroke="var(--mg-coral, #ff607c)" strokeWidth="1.2" />
    </svg>
  )
}
