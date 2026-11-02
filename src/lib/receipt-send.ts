// Client side of "Send to customer". No React here so the stale-result rule can be unit tested.

export type SendStatus = { state: 'idle' | 'sending' | 'sent'; error: string; canOpenChat: boolean }

export const SEND_IDLE: SendStatus = { state: 'idle', error: '', canOpenChat: true }

type Post = (ids: string[]) => Promise<SendStatus>

export async function postReceipt(ids: string[]): Promise<SendStatus> {
  try {
    const res = await fetch('/api/transactions/send-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    const data: { error?: string; canOpenChat?: boolean } = await res.json().catch(() => ({}))
    if (res.ok) return { state: 'sent', error: '', canOpenChat: data.canOpenChat !== false }
    return { ...SEND_IDLE, error: data.error ?? 'The receipt could not be sent. Please try again.' }
  } catch {
    return { ...SEND_IDLE, error: 'No connection. Check your internet and try again.' }
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
