'use client'
import { useRouter, usePathname } from 'next/navigation'

interface NavItem {
  key: string
  icon: string
  label: string
  href: string
}

interface AgentBottomNavProps {
  items: NavItem[]
}

export default function AgentBottomNav({ items }: AgentBottomNavProps) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <>
      <style>{`
        @media (min-width: 769px) {
          [data-agent-bottom-nav] { display: none !important; }
        }
      `}</style>
      <div data-agent-bottom-nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: 64,
        background: '#fff', borderTop: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'stretch', zIndex: 100,
        boxShadow: '0 -3px 14px rgba(0,0,0,.07)',
      }}>
      {items.map(item => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <button key={item.key} onClick={() => router.push(item.href)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 3, border: 'none', background: 'transparent',
            cursor: 'pointer', position: 'relative', padding: '4px 2px',
            color: isActive ? '#1a5c35' : '#aaa',
            fontWeight: isActive ? 700 : 600,
            fontSize: 9.5,
          }}>
            {isActive && <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 3, background: '#1a5c35', borderRadius: '0 0 3px 3px' }} />}
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            {item.label}
          </button>
        )
      })}
      </div>
    </>
  )
}
