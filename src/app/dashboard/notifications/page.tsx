'use client'
import NotificationList from '@/components/ui/NotificationList'

export default function AgentNotificationsPage() {
  return (
    <div className="ag-page ag-card-page">
      <NotificationList feedUrl="/api/agent/notifications" />
    </div>
  )
}
