/** wa.me needs the number in international form: 0803… → 234803… */
export function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, '')
  return d.startsWith('0') ? `234${d.slice(1)}` : d
}

/** Opens a WhatsApp chat with this number, with the message typed in (the sender still taps send). */
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`
}
