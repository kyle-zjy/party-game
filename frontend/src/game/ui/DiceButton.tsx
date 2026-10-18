import { useEffect, useState } from 'react'
import './dice.css'

const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [28, 72], [72, 28], [72, 72]],
  5: [[28, 28], [28, 72], [50, 50], [72, 28], [72, 72]],
  6: [[28, 24], [28, 50], [28, 76], [72, 24], [72, 50], [72, 76]],
}

function DiceFace({ value, glow }: { value: number; glow: boolean }) {
  const pips = PIP_LAYOUTS[value] ?? PIP_LAYOUTS[1]!
  return (
    <svg viewBox="0 0 100 100" className={`mg-dice-face${glow ? ' mg-dice-face-glow' : ''}`} aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="18" className="mg-dice-body" />
      {pips.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="8" className="mg-dice-pip" />
      ))}
    </svg>
  )
}

export function DiceButton({
  value,
  rolling,
  disabled,
  onRoll,
  label,
}: {
  value: number | null
  rolling: boolean
  disabled: boolean
  onRoll: () => void
  label: string
}) {
  const [spinValue, setSpinValue] = useState(1)

  useEffect(() => {
    if (!rolling) return undefined
    const interval = setInterval(() => {
      setSpinValue(1 + Math.floor(Math.random() * 6))
    }, 80)
    return () => clearInterval(interval)
  }, [rolling])

  const displayValue = rolling ? spinValue : value ?? 1
  const isNaturalSix = !rolling && value === 6

  return (
    <button
      type="button"
      className={`mg-dice-btn${rolling ? ' mg-dice-rolling' : ''}`}
      onClick={onRoll}
      disabled={disabled || rolling}
      aria-label={label}
    >
      <DiceFace value={displayValue} glow={isNaturalSix} />
      <span className="mg-dice-label">{rolling ? '摇动中…' : label}</span>
    </button>
  )
}
