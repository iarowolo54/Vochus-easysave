'use client'
// A receipt sent from "Send to customer", shown in the chat as the receipt picture (the same drawing as "Save receipt
// image"). The facts come from the server (CustomerChatMessage.receipt). Until the picture is drawn, or if this phone
// can't draw it, the receipt's text is shown instead, so nothing is ever blank.
import { useEffect, useState } from 'react'
import type { ReceiptCard } from '@/lib/receipt-card'
import { receiptImageUrl, saveReceiptImage } from '@/lib/receipt-image'

export default function ReceiptBubble({ card, text, textClassName, imageClassName }: {
  card: ReceiptCard
  /** The receipt as text: shown while the picture is drawn and if it can't be. */
  text: string
  textClassName: string
  imageClassName: string
}) {
  const [src, setSrc] = useState<string | null>(null)

  // The card is stored JSON, so its text is a stable key for redrawing.
  const key = JSON.stringify(card)
  useEffect(() => {
    let live = true
    receiptImageUrl(card).then(url => {
      if (live) setSrc(url)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when the receipt itself changes
  }, [key])

  if (!src) return <p className={textClassName}>{text}</p>

  const label = `${card.title} receipt, ${card.amount}, ${card.status}. Tap to save.`
  return (
    <button type="button" className={imageClassName} onClick={() => { void saveReceiptImage(card) }} aria-label={label}>
      <img src={src} alt="" />
    </button>
  )
}
