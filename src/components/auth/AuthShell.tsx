import type { ReactNode } from 'react'
import Logo from '@/components/Logo'

type Props = {
  title: string
  lead?: string
  /** Small label after the brand name, e.g. "Agent" or "Admin". */
  audience?: string
  footer?: ReactNode
  children: ReactNode
}

/** Shared layout for every sign-in screen (customer, agent, super admin). Sized to fit one phone screen. */
export default function AuthShell({ title, lead, audience, footer, children }: Props) {
  return (
    <div className="ui-screen ui-auth">
      <main className="ui-auth-inner">
        <div className="ui-auth-brand">
          <Logo size={44} />
          <span>Vochus Easy Save</span>
          {audience && <span className="ui-auth-audience">{audience}</span>}
        </div>
        <h1 className="ui-page-title">{title}</h1>
        {lead && <p className="ui-auth-lead">{lead}</p>}
        {children}
        {footer && <div className="ui-auth-foot">{footer}</div>}
      </main>
    </div>
  )
}
