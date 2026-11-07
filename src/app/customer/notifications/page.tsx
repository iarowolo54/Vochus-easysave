'use client'
import { useRouter } from 'next/navigation'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import NotificationList from '@/components/ui/NotificationList'
import { Icons } from '@/components/ui/icons'

export default function CustomerNotificationsPage() {
  const router = useRouter()
  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        <button type="button" className="ui-icon-btn" onClick={() => router.push('/customer/dashboard')} aria-label="Back to Home">
          <Icons.back size={22} aria-hidden="true" />
        </button>
        <div className="ui-topbar-main"><h1 className="ui-topbar-title">Notifications</h1></div>
      </header>
      <main className="ui-container">
        <NotificationList feedUrl="/api/customer/notifications" />
      </main>
      <CustomerBottomNav />
    </div>
  )
}
