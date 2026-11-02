// Client side of "Send to customer". No React here so the stale-result rule can be unit tested.

export type SendStatus = { state: 'idle' | 'sending' | 'sent'; error: string; canOpenChat: boolean; hasPhone: boolean }

export const SEND_IDLE: SendStatus = { state: 'idle', error: '', canOpenChat: true, hasPhone: true }

type Post = (ids: string[]) => Promise<SendStatus>

const SEND_TIMEOUT_MS = 15000

export async function postReceipt(ids: string[], timeoutMs = SEND_TIMEOUT_MS): Promise<SendStatus> {
  // Not AbortSignal.timeout, which throws on older WebViews.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('/api/transactions/send-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), signal: ctrl.signal })
    const data: { error?: string; canOpenChat?: boolean; hasPhone?: boolean } = await res.json().catch(() => ({}))
    if (res.ok) return { state: 'sent', error: '', canOpenChat: data.canOpenChat !== false, hasPhone: data.hasPhone !== false }
    return { ...SEND_IDLE, error: data.error ?? 'The receipt could not be sent. Please try again.' }
  } catch {
    // A request we gave up on may still have reached the server.
    return { ...SEND_IDLE, error: ctrl.signal.aborted ? 'This is taking long. It may have been sent, so check the chat before trying again.' : 'No connection. Check your internet and try again.' }
  } finally {
    clearTimeout(timer)
  }
}

/** Only the latest send may report back: after reset(), a slow result can't land on the next receipt. */
export function createReceiptSender(onChange: (status: SendStatus) => void, post: Post = postReceipt) {
  let latest = 0
  return {
    async send(ids: string[]) {
      const mine = ++latest
      onChange({ ...SEND_IDLE, state: 'sending' })
      const result = await post(ids)
      if (mine === latest) onChange(result)
    },
    reset() {
      latest++
      onChange(SEND_IDLE)
    },
  }
}
