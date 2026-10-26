import type { ReactNode } from 'react'
import { Icons, type IconName } from './icons'

type Props = {
  icon: IconName
  title: string
  text?: string
  action?: ReactNode
}

export default function EmptyState({ icon, title, text, action }: Props) {
  const Icon = Icons[icon]
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon" aria-hidden="true"><Icon size={24} /></span>
      <p className="ui-empty-title">{title}</p>
      {text && <p className="ui-empty-text">{text}</p>}
      {action}
    </div>
  )
}
