'use client'
import { FormError } from './FormErrors'
import { Icons } from './icons'
import type { SendStatus } from '@/lib/receipt-send'

/** Error and outcome of a send. The status region stays mounted so screen readers announce the change. */
export function SendReceiptNotices({ send }: { send: SendStatus }) {
  return (
    <>
      <FormError message={send.error} />
      <div role="status">
        {send.state === 'sent' && (send.canOpenChat
          ? <span className="ui-sr-only">Receipt sent to chat</span>
          : (
            <div className="ui-banner ui-banner--warn">
              <Icons.error size={18} aria-hidden="true" />
              <div>Saved in chat. This customer can’t sign in yet, so send it on WhatsApp too.</div>
            </div>
          ))}
      </div>
    </>
  )
}

export function SendReceiptButton({ send, onSend, block }: { send: SendStatus; onSend: () => void; block?: boolean }) {
  const done = send.state === 'sent'
  return (
    <button type="button" className={`ui-btn ${done ? 'ui-btn--done' : 'ui-btn--primary'}${block ? ' ui-btn--block' : ''}`} onClick={onSend} disabled={send.state !== 'idle'}>
      {send.state === 'sending'
        ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</>
        : done
          ? <><Icons.check size={18} aria-hidden="true" /> {send.canOpenChat ? 'Sent to chat' : 'Saved in chat'}</>
          : <><Icons.chat size={18} aria-hidden="true" /> {send.error ? 'Try again' : 'Send to customer'}</>}
    </button>
  )
}
