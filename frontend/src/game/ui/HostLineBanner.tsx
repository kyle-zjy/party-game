import { useState } from 'react'
import type { HostLine } from '../tutorial/tutorialLines'
import { HostAvatar } from './HostAvatar'

/** "今晚的主持人"提示：默认最多两行，点一下展开完整说明 */
export function HostLineBanner({ line }: { line: HostLine }) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = Boolean(line.detail) || line.message.length > 34

  return (
    <button
      type="button"
      className={`mg-host-banner mg-host-banner-compact mg-fade-in${expanded ? ' mg-host-banner-open' : ''}`}
      key={line.message}
      onClick={() => canExpand && setExpanded((v) => !v)}
      aria-expanded={expanded}
    >
      <span className="mg-host-avatar">
        <HostAvatar />
      </span>
      <span className="mg-host-text">
        <span className="mg-host-message">{line.message}</span>
        {expanded && line.detail && <span className="mg-host-detail">{line.detail}</span>}
      </span>
      {canExpand && <span className="mg-host-chevron">{expanded ? '▲' : '▼'}</span>}
    </button>
  )
}
