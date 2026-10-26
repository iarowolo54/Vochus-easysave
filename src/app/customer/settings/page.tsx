'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'
import Logo from '@/components/Logo'
import { CUSTOMER_NAV } from '@/components/nav-items'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { Icons } from '@/components/ui/icons'
import { displayName } from '@/lib/format'
import { getHideBalance, getTextSize, setHideBalance, setTextSize, type TextSize } from '@/lib/preferences'

type CustomerData = { customerId: string; name: string; phone: string; email: string | null; photoUrl: string | null }

export default function CustomerSettingsPage() {
  const router = useRouter()
  const { data, loading, failed, reload } = useCustomerMe<CustomerData>()
  const [textSize, setSize] = useState<TextSize>('normal')
  const [hideBalance, setHide] = useState(false)

  useEffect(() => {
    setSize(getTextSize())
    setHide(getHideBalance())
  }, [])

  function chooseSize(size: TextSize) {
    setTextSize(size)
    setSize(size)
  }

  function toggleHide() {
    setHideBalance(!hideBalance)
    setHide(!hideBalance)
  }

  async function logout() {
    await fetch('/api/customer/auth/login', { method: 'DELETE' })
    router.push('/customer/login')
  }

  if (loading) return (
    <div className="ui-screen ui-screen--center" role="status" aria-label="Loading settings">
      <div className="ui-spinner" />
    </div>
  )

  if (failed || !data) return (
    <div className="ui-screen ui-screen--center">
      {failed && (
        <EmptyState
          icon="error"
          title="We couldn't load your settings"
          text="Check your connection and try again."
          action={
            <button type="button" className="ui-btn ui-btn--primary" onClick={reload}>
              <Icons.retry size={18} aria-hidden="true" /> Try again
            </button>
          }
        />
      )}
    </div>
  )

  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        <div className="ui-topbar-main">
          <h1 className="ui-page-title">Settings</h1>
        </div>
      </header>

      <main className="ui-container">
        <section className="ui-card ui-card--list" aria-label="Your account">
          <ListRow
            leading={data.photoUrl
              ? <img src={data.photoUrl} className="ui-avatar" alt="" />
              : <span className="ui-avatar" aria-hidden="true">{data.name[0]}</span>}
            title={displayName(data.name)}
            sub={data.customerId}
          />
          <ListRow title="Phone" value={data.phone} />
          {data.email && <ListRow title="Email" value={data.email} />}
        </section>

        <div className="ui-section-head"><h2>Display</h2></div>
        <section className="ui-card">
          <p className="ui-row-title" id="text-size-label">Text size</p>
          <p className="ui-row-sub" style={{ marginBottom: 'var(--ui-s3)' }}>Make words and numbers bigger on this phone.</p>
          <div className="ui-segment" role="group" aria-labelledby="text-size-label">
            <button type="button" aria-pressed={textSize === 'normal'} onClick={() => chooseSize('normal')}>Normal</button>
            <button type="button" aria-pressed={textSize === 'large'} onClick={() => chooseSize('large')} style={{ fontSize: '1.15em' }}>Large</button>
          </div>
        </section>
        <section className="ui-card ui-card--list">
          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title" id="hide-balance-label">Hide my balance</div>
              <div className="ui-row-sub">Show ₦ •••• on the home screen until you tap the eye.</div>
            </div>
            <button
              type="button"
              role="switch"
              className="ui-switch"
              aria-checked={hideBalance}
              aria-labelledby="hide-balance-label"
              onClick={toggleHide}
            />
          </div>
        </section>

        <div className="ui-section-head"><h2>App</h2></div>
        <section className="ui-card ui-card--list">
          <ListRow
            leading={<Logo size={40} />}
            title="Vochus Easy Save for Android"
            sub="Faster to open, works like a normal app."
          />
          <div className="ui-btn-row ui-btn-row--single">
            <a className="ui-btn ui-btn--secondary" href="/downloads/easysave-customer.apk" download>
              <Icons.download size={18} aria-hidden="true" /> Download the app
            </a>
          </div>
        </section>

        <button type="button" className="ui-btn ui-btn--danger ui-btn--block" onClick={logout} style={{ marginTop: 'var(--ui-s5)' }}>
          <Icons.logout size={18} aria-hidden="true" /> Log out
        </button>
      </main>

      <BottomNav items={CUSTOMER_NAV} />
    </div>
  )
}
