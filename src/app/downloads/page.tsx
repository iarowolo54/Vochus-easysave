import Link from 'next/link'

export const metadata = { title: 'Download Mobile Apps · Vochus Easy Save' }

type App = {
  name: string
  tagline: string
  href: string
  accent: string
  icon: string
}

const APPS: App[] = [
  {
    name: 'Vochus Easy Save',
    tagline: 'Customer app — track your savings, redeem, and view transactions.',
    href: '/downloads/easysave-customer.apk',
    accent: 'linear-gradient(135deg,#2ecc71,#0e4d24)',
    icon: 'V',
  },
  {
    name: 'Vochus Easy Save Agent',
    tagline: 'Agent app — enroll customers, manage plans, and run collections.',
    href: '/downloads/easysave-agent.apk',
    accent: 'linear-gradient(135deg,#0e4d24,#1a3a1f)',
    icon: 'A',
  },
]

export default function DownloadsPage() {
  return (
    <div style={{ minHeight: '100dvh', background: '#f3f6f3', padding: '40px 20px', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 28, fontWeight: 900, color: '#111a14' }}>
            Download our Android Apps
          </div>
          <div style={{ fontSize: 14, color: '#6b8070', marginTop: 6 }}>
            Install the APK directly on your Android device.
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {APPS.map(app => (
            <div key={app.href} style={{ background: '#fff', border: '1px solid #d8e8dd', borderRadius: 16, padding: 20, display: 'flex', alignItems: 'center', gap: 18, boxShadow: '0 2px 12px rgba(0,0,0,.05)' }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, background: app.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 28, fontWeight: 900, flexShrink: 0 }}>
                {app.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 17, fontWeight: 800, color: '#111a14' }}>{app.name}</div>
                <div style={{ fontSize: 13, color: '#6b8070', marginTop: 4 }}>{app.tagline}</div>
              </div>
              <a href={app.href} download style={{ padding: '11px 18px', background: app.accent, color: '#fff', borderRadius: 11, fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(14,77,36,.25)' }}>
                Download APK
              </a>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28, background: '#fff', border: '1px solid #d8e8dd', borderRadius: 14, padding: 18, fontSize: 13, color: '#3a4a40', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 800, marginBottom: 6, color: '#111a14' }}>Installation</div>
          1. Download the APK on your Android device.<br />
          2. Open the file — Android will prompt you to allow installs from this source.<br />
          3. Tap <b>Install</b>, then <b>Open</b>.
        </div>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13 }}>
          <Link href="/" style={{ color: '#0e4d24', fontWeight: 700, textDecoration: 'none' }}>← Back to home</Link>
        </div>
      </div>
    </div>
  )
}
