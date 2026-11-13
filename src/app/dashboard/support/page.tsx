'use client'
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SupportChatScreen from '@/components/SupportChatScreen'
import { sessionHasEnded } from '@/lib/session-ended'

/** The agent's private chat with Vochus Support. */
export default function AgentSupportPage() {
  const router = useRouter()
  // One 401 can be a busy database; the layout signs the agent out if the session really ended.
  const onUnauthorized = useCallback(() => {
    sessionHasEnded().then(ended => { if (ended) window.location.assign('/login?ended=1') })
  }, [])
  const onBack = useCallback(() => {
    if (window.history.length > 1) router.back(); else router.push('/dashboard')
  }, [router])

  return (
    <SupportChatScreen who="agent" endpoint="/api/agent/support" onBack={onBack} onUnauthorized={onUnauthorized}
      emptyText="Ask the Vochus office about your wallet, commission, a customer or anything else." />
  )
}
