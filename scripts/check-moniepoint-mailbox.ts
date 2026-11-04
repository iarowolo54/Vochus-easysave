// Read-only check that the Gmail connection and the Moniepoint alert reader work. Credits nothing, writes nothing.
//   npx tsx --env-file=.env scripts/check-moniepoint-mailbox.ts
import { writeFileSync } from 'node:fs'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { isAuthenticAlert, parseMoniepointAlert } from '../src/lib/moniepoint-alert'

function need(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`Missing ${name} in .env`); process.exit(1) }
  return v
}

const sender = need('MONIEPOINT_SENDER')
for (const n of ['MONIEPOINT_ACCOUNT_NUMBER', 'MONIEPOINT_ACCOUNT_NAME', 'CRON_SECRET']) need(n)

async function main() {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: need('IMAP_USER'), pass: need('IMAP_APP_PASSWORD') },
  })

  await client.connect()
  console.log('Connected to Gmail.')
  let scanned = 0, authentic = 0, parsed = 0
  let latest = ''
  const unread = new Map<string, number>()
  const dump: string[] = []
  const lock = await client.getMailboxLock('INBOX', { readOnly: true })
  try {
    const uids = await client.search({ from: sender, since: new Date(Date.now() - 7 * 86_400_000) }, { uid: true })
    console.log(`Mail from ${sender} in the last 7 days: ${uids ? uids.length : 0}`)
    for await (const msg of client.fetch(uids || [], { source: true }, { uid: true })) {
      if (!msg.source) continue
      scanned++
      const mail = await simpleParser(msg.source)
      const ar = mail.headerLines.filter((h) => h.key === 'authentication-results').map((h) => h.line.slice(h.line.indexOf(':') + 1))
      if (!isAuthenticAlert((mail.from?.value ?? []).map((a) => a.address ?? ''), ar, sender)) continue
      authentic++
      const alert = parseMoniepointAlert(mail.text || (typeof mail.html === 'string' ? mail.html : ''))
      if (!alert) {
        const subject = mail.subject ?? '(no subject)'
        unread.set(subject, (unread.get(subject) ?? 0) + 1)
        if (/credit/i.test(subject)) {
          const text = (mail.text || (typeof mail.html === 'string' ? mail.html.replace(/<[^>]+>/g, ' ') : '')).replace(/https?:\/\/\S+/g, '<link>')
          dump.push(`=== ${mail.date?.toISOString() ?? 'no date'} | ${subject}\n${text.replace(/\s+/g, ' ').trim()}`)
        }
        continue
      }
      parsed++
      latest = `₦${alert.amount.toFixed(2)} at ${alert.at.toISOString()}`
    }
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }
  console.log(`Scanned ${scanned}, passed the sender check ${authentic}, read as credit alerts ${parsed}.`)
  if (latest) console.log(`Latest alert: ${latest}`)
  const out = process.argv[2]
  if (out && dump.length) {
    writeFileSync(out, dump.join('\n\n'))
    console.log(`Saved ${dump.length} unread credit email(s) to ${out}`)
  }
  if (unread.size) {
    console.log('Authentic but not read as a credit alert (subject: count):')
    for (const [subject, n] of unread) console.log(`  ${subject}: ${n}`)
  }
}

main().catch((e) => {
  console.error('Check failed:', e instanceof Error ? e.message : 'unknown error')
  process.exit(1)
})
