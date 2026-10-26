import type { ReactNode } from 'react'
import { Icons, type IconName } from './icons'

type Props = {
  title: ReactNode
  sub?: ReactNode
  value?: ReactNode
  icon?: IconName
  /** Custom leading element (e.g. an avatar) when an icon isn't right. */
  leading?: ReactNode
}

/** Icon · title/subtitle · value — the one row layout for lists inside a .ui-card--list. */
export default function ListRow({ title, sub, value, icon, leading }: Props) {
  const Icon = icon ? Icons[icon] : null
  return (
    <div className="ui-row">
      {leading ?? (Icon && <span className="ui-row-icon" aria-hidden="true"><Icon size={20} /></span>)}
      <div className="ui-row-main">
        <div className="ui-row-title">{title}</div>
        {sub && <div className="ui-row-sub">{sub}</div>}
      </div>
      {value !== undefined && <div className="ui-row-value">{value}</div>}
    </div>
  )
}
