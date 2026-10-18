import { useState } from 'react'
import type { HostLine } from '../tutorial/tutorialLines'
import { HostAvatar } from './HostAvatar'

/** "今晚的主持人"气泡——贯穿全程的情境式教学提示，点开可以看补充说明 */
export function HostLineBanner({ line }: { line: HostLine }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mg-host-banner mg-fade-in" key={line.message}>
      <div className="mg-host-avatar">
        <HostAvatar />
      </div>
      <div className="mg-host-text">
        <p className="mg-host-message">{line.message}</p>
        {line.detail && (
          <button type="button" className="mg-host-detail-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起说明 ▲' : '为什么要这样做？ ▼'}
          </button>
        )}
        {expanded && line.detail && <p className="mg-host-detail">{line.detail}</p>}
      </div>
    </div>
  )
}
