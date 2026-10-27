import type { ReactNode } from 'react'
import { Icons, type IconName } from './icons'

type Props = {
  title: ReactNode
  sub?: ReactNode
  value?: ReactNode
  icon?: IconName
  /** Custom leading element (e.g. an avatar) when an icon isn't right. */
  leading?: ReactNode
  /** Makes the row a button (with a chevron), e.g. to open a receipt. */
  onClick?: () => void
}

/** Icon · title/subtitle · value — the one row layout for lists inside a .ui-card--list. */
export default function ListRow({ title, sub, value, icon, leading, onClick }: Props) {
  const Icon = icon ? Icons[icon] : null
  const body = (
    <>
      {leading ?? (Icon && <span className="ui-row-icon" aria-hidden="true"><Icon size={20} /></span>)}
      <span className="ui-row-main">
        <span className="ui-row-title ui-block">{title}</span>
        {sub && <span className="ui-row-sub ui-block">{sub}</span>}
      </span>
      {value !== undefined && <span className="ui-row-value">{value}</span>}
    </>
  )
  if (!onClick) return <div className="ui-row">{body}</div>
  return (
    <button type="button" className="ui-row ui-row--button" onClick={onClick}>
      {body}
      <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
    </button>
  )
}
