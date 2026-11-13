// The agent's and the customer's side of the support chat. Both routes call these with a Party built from their own
// session, so neither can reach anyone else's thread: there is no thread id in their requests at all.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createRateLimiter } from '@/lib/rate-limit'
import {
  getOrCreateThread, loadMessages, parseMessageInput, partyUnreadCount, partyView, partyWhere, sendSupportMessage, type Party,
} from '@/lib/support-chat'

// Per process (two PM2 instances), so a soft cap: enough for a real conversation, not for flooding the office.
const sendLimiter = createRateLimiter()
const SEND_LIMIT = 20
const SEND_WINDOW_MS = 60_000

export async function partyThreadResponse(party: Party, partyName: string) {
  const thread = await prisma.supportThread.findFirst({ where: partyWhere(party), select: { id: true } })
  if (!thread) return NextResponse.json({ messages: [] }, { headers: { 'Cache-Control': 'no-store' } })

  const messages = await loadMessages(prisma, thread.id)
  await prisma.supportMessage.updateMany({ where: { threadId: thread.id, sender: 'admin', readByParty: false }, data: { readByParty: true } })
  return NextResponse.json({ messages: messages.map((m) => partyView(m, partyName)) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function partySendResponse(party: Party, partyName: string, body: unknown) {
  const input = parseMessageInput(body)
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })

  const rl = sendLimiter.check(`${party.type}:${party.id}`, SEND_LIMIT, SEND_WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'You’re sending messages too quickly. Wait a moment, then try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  const thread = await getOrCreateThread(prisma, party)
  const msg = await sendSupportMessage(prisma, {
    threadId: thread.id, party, sender: party.type, senderId: party.id, senderName: partyName,
    message: input.message, imageUrl: input.imageUrl,
  })
  return NextResponse.json({ message: partyView(msg, partyName) }, { status: 201 })
}

export async function partyUnreadResponse(party: Party) {
  const count = await partyUnreadCount(prisma, party)
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } })
}
