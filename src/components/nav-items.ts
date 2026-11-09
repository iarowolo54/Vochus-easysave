import type { IconName } from './ui/icons'

export interface NavItem {
  key: string
  icon: IconName
  label: string
  href: string
  /** Raised centre button for the main action. */
  prominent?: boolean
  /** Opens the full menu instead of navigating. */
  more?: boolean
}

export const CUSTOMER_NAV: NavItem[] = [
  { key: 'home',     icon: 'home',     label: 'Home',     href: '/customer/dashboard' },
  { key: 'save',     icon: 'plan',     label: 'Save',     href: '/customer/save' },
  { key: 'history',  icon: 'history',  label: 'History',  href: '/customer/transactions' },
  { key: 'chat',     icon: 'chat',     label: 'Chat',     href: '/customer/chat' },
  { key: 'settings', icon: 'settings', label: 'Settings', href: '/customer/settings' },
]

export const AGENT_NAV: NavItem[] = [
  { key: 'dashboard', icon: 'home',      label: 'Home',        href: '/dashboard' },
  { key: 'customers', icon: 'customers', label: 'Customers',   href: '/dashboard/customers' },
  { key: 'savings',   icon: 'add',       label: 'Record',      href: '/dashboard/savings', prominent: true },
  { key: 'redeem',    icon: 'collect',   label: 'Redemptions', href: '/dashboard/redeem' },
  { key: 'more',      icon: 'menu',      label: 'More',        href: '#', more: true },
]
