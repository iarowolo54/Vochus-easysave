import type { IconName } from './ui/icons'

export interface NavItem {
  key: string
  icon: IconName
  label: string
  href: string
}

export const CUSTOMER_NAV: NavItem[] = [
  { key: 'home',     icon: 'home',     label: 'Home',     href: '/customer/dashboard' },
  { key: 'save',     icon: 'plan',     label: 'Save',     href: '/customer/save' },
  { key: 'history',  icon: 'history',  label: 'History',  href: '/customer/transactions' },
  { key: 'chat',     icon: 'chat',     label: 'Chat',     href: '/customer/chat' },
  { key: 'settings', icon: 'settings', label: 'Settings', href: '/customer/settings' },
]

export const AGENT_NAV: NavItem[] = [
  { key: 'dashboard', icon: 'home',      label: 'Dashboard', href: '/dashboard' },
  { key: 'customers', icon: 'customers', label: 'Customers', href: '/dashboard/customers' },
  { key: 'savings',   icon: 'plan',      label: 'Savings',   href: '/dashboard/savings' },
  { key: 'chat',      icon: 'support',   label: 'Support',   href: '/dashboard/chat' },
]
