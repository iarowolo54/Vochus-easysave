'use client'
import { useRouter, usePathname } from 'next/navigation'

interface NavItem {
  key: string
  icon: string
  label: string
  href: string
}

interface BottomNavProps {
  items: NavItem[]
}

export default function BottomNav({ items }: BottomNavProps) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <>
      <style>{`
        @media (min-width: 769px) {
          [data-bottom-nav] { display: none !important; }
        }
      `}</style>
      <div data-bottom-nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: 64,
        background: 'var(--card)', borderTop: '1px solid var(--br)',
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
            color: isActive ? 'var(--g)' : '#aaa',
            fontWeight: isActive ? 700 : 600,
            fontSize: 9.5,
          }}>
            {isActive && <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 3, background: 'var(--g)', borderRadius: '0 0 3px 3px' }} />}
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            {item.label}
          </button>
        )
      })}
      </div>
    </>
  )
}
