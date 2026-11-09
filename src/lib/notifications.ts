// In-app notifications: the ONE catalogue. Every notification an agent or customer can see is built here, with fixed
// wording from typed facts, so no code, OTP or password can ever end up in one.
//
// How to use it (see .claude/rules/backend-api.md, enforced by tests/notification-coverage.test.ts):
//   inside the same transaction as the change:   await notify(tx, notifications.collectionPaid({...}))
//   or, for a batch $transaction([...ops]):      ...notificationOps(prisma, notifications.collectionPaid({...}))
// Writes are upserts on dedupeKey that never overwrite, so a retry, a webhook replay or the nightly safety net
// (src/lib/notification-sweep.ts) can't create a duplicate.
import type { Prisma } from '@prisma/client'
import { displayName, formatNaira, formatTime } from '@/lib/format'
import { receiptHref } from '@/lib/hand-receipt'

export type RecipientType = 'agent' | 'customer'
export interface Recipient { type: RecipientType; id: string }

export type NotificationKind =
  | 'saving_received' | 'online_saving_by_transfer'
  | 'collection_requested' | 'collection_wanted' | 'collection_approved' | 'collection_paid' | 'collection_paid_agent'
  | 'collection_declined' | 'collection_declined_agent'
  | 'wallet_funded' | 'withdrawal_paid' | 'withdrawal_declined'
  | 'plan_ending_soon' | 'plan_ended' | 'plans_ending_this_week'
  | 'plan_uncollected' | 'uncollected_this_week'
  | 'ajo_joined' | 'ajo_started' | 'ajo_paid' | 'ajo_paid_agent' | 'ajo_round_out' | 'ajo_due' | 'ajo_late' | 'ajo_stopped' | 'ajo_replaced'
  | 'new_phone'

export interface NotificationEvent {
  recipient: Recipient
  kind: NotificationKind
  title: string
  body?: string
  href: string
  dedupeKey: string
  /** When it happened, if not now (the nightly safety net back-dates what it fills in). */
  at?: Date
}

/** ₦2,000 for whole naira, ₦150.10 when there is kobo. */
const naira = (n: number) => formatNaira(n, Number.isInteger(n) ? { minor: false } : {})
const name = (s: string) => displayName(s)
const shortDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const customer = (id: string): Recipient => ({ type: 'customer', id })
const agent = (id: string): Recipient => ({ type: 'agent', id })

type CollectionFacts = { id: string; customerId: string; agentId: string; customerName: string; amount: number }

export const notifications = {
  /** Money reached a plan. The agent also hears about it when one of their online customers paid by bank transfer. */
  savingsReceived(f: { ref: string; customerId: string; agentId: string; customerName: string; planGoal: string; amount: number; fee?: number; onlineTransfer: boolean }): NotificationEvent[] {
    const fee = f.fee && f.fee > 0 ? f.fee : 0
    const out: NotificationEvent[] = [{
      recipient: customer(f.customerId), kind: 'saving_received', title: `${naira(f.amount)} saved into ${f.planGoal}`,
      body: fee ? `${naira(fee)} was the platform fee. ${naira(Math.max(0, Math.round((f.amount - fee) * 100) / 100))} was added to your balance.` : undefined,
      href: receiptHref(f.ref), dedupeKey: `saving:${f.ref}`,
    }]
    if (f.onlineTransfer) out.push({
      recipient: agent(f.agentId), kind: 'online_saving_by_transfer', title: `${name(f.customerName)} saved ${naira(f.amount)} by transfer`,
      href: '/dashboard/customers', dedupeKey: `saving-agent:${f.ref}`,
    })
    return out
  },

  /** A collection was asked for. When the customer asked, their agent is told it's waiting for them. */
  collectionRequested(f: CollectionFacts & { byCustomer: boolean }): NotificationEvent[] {
    const out: NotificationEvent[] = [{
      recipient: customer(f.customerId), kind: 'collection_requested', title: 'Your collection request was sent',
      body: `${naira(f.amount)} will be paid once it’s approved.`, href: '/customer/redeem', dedupeKey: `collection-requested:${f.id}`,
    }]
    if (f.byCustomer) out.push({
      recipient: agent(f.agentId), kind: 'collection_wanted', title: `${name(f.customerName)} wants to collect ${naira(f.amount)}`,
      href: '/dashboard/redeem', dedupeKey: `collection-wanted:${f.id}`,
    })
    return out
  },

  /** The agent approved (or confirmed the customer's code); the office pays next. */
  collectionApproved(f: CollectionFacts): NotificationEvent[] {
    return [{
      recipient: customer(f.customerId), kind: 'collection_approved', title: 'Your collection was approved',
      body: 'The office is now paying it.', href: '/customer/redeem', dedupeKey: `collection-approved:${f.id}`,
    }]
  },

  /** The payout is done. */
  collectionPaid(f: CollectionFacts): NotificationEvent[] {
    return [
      { recipient: customer(f.customerId), kind: 'collection_paid', title: `${naira(f.amount)} has been paid to you`, href: '/customer/redeem', dedupeKey: `collection-paid:${f.id}` },
      { recipient: agent(f.agentId), kind: 'collection_paid_agent', title: `${name(f.customerName)}’s collection of ${naira(f.amount)} was paid`, href: '/dashboard/redeem', dedupeKey: `collection-paid-agent:${f.id}` },
    ]
  },

  /** byAgent: the agent declined it themselves, so only the customer is told. */
  collectionDeclined(f: CollectionFacts & { reason?: string | null; byAgent?: boolean }): NotificationEvent[] {
    const why = f.reason?.trim() ? `Reason: ${f.reason.trim()}` : undefined
    const out: NotificationEvent[] = [
      { recipient: customer(f.customerId), kind: 'collection_declined', title: 'Your collection request was declined', body: why, href: '/customer/redeem', dedupeKey: `collection-declined:${f.id}` },
    ]
    if (!f.byAgent) out.push({ recipient: agent(f.agentId), kind: 'collection_declined_agent', title: `${name(f.customerName)}’s collection request was declined`, body: why, href: '/dashboard/redeem', dedupeKey: `collection-declined-agent:${f.id}` })
    return out
  },

  walletFunded(f: { agentId: string; amount: number; ref: string }): NotificationEvent[] {
    return [{ recipient: agent(f.agentId), kind: 'wallet_funded', title: `${naira(f.amount)} added to your wallet`, href: '/dashboard/wallet', dedupeKey: `wallet:${f.ref}` }]
  },

  withdrawalPaid(f: { id: string; agentId: string; amount: number }): NotificationEvent[] {
    return [{ recipient: agent(f.agentId), kind: 'withdrawal_paid', title: `Your withdrawal of ${naira(f.amount)} was paid`, href: '/dashboard/withdraw', dedupeKey: `withdrawal-paid:${f.id}` }]
  },

  withdrawalDeclined(f: { id: string; agentId: string; amount: number; reason?: string | null }): NotificationEvent[] {
    const why = f.reason?.trim() ? ` Reason: ${f.reason.trim()}` : ''
    return [{
      recipient: agent(f.agentId), kind: 'withdrawal_declined', title: `Your withdrawal of ${naira(f.amount)} was declined`,
      body: `The money is back in your commission.${why}`, href: '/dashboard/withdraw', dedupeKey: `withdrawal-declined:${f.id}`,
    }]
  },

  planEndingSoon(f: { planId: string; customerId: string; goal: string; maturityDate: Date }): NotificationEvent[] {
    return [{ recipient: customer(f.customerId), kind: 'plan_ending_soon', title: `Your ${f.goal} plan ends on ${shortDay(f.maturityDate)}`, href: '/customer/dashboard', dedupeKey: `plan-ending:${f.planId}` }]
  },

  planEnded(f: { planId: string; customerId: string; goal: string; ajo?: boolean }): NotificationEvent[] {
    if (f.ajo) return [{ recipient: customer(f.customerId), kind: 'plan_ended', title: `Your ${f.goal} money is ready`, body: 'Collect it from Home.', href: '/customer/dashboard', dedupeKey: `plan-ended:${f.planId}` }]
    return [{ recipient: customer(f.customerId), kind: 'plan_ended', title: `Your ${f.goal} plan has ended`, body: 'You can collect it now, or keep saving into it again from Home.', href: '/customer/dashboard', dedupeKey: `plan-ended:${f.planId}` }]
  },

  /** Every 7 days after a plan ends while money is still in it (the end day itself is planEnded). */
  planUncollected(f: { planId: string; customerId: string; goal: string; balance: number; week: number; ajo?: boolean }): NotificationEvent[] {
    return [{
      recipient: customer(f.customerId), kind: 'plan_uncollected', title: `${naira(f.balance)} is waiting in your ${f.goal} plan`,
      body: f.ajo ? 'Collect your Ajo money from Home.' : 'Your plan has ended. Collect your money, or keep saving into it again from Home.',
      href: '/customer/dashboard', dedupeKey: `plan-uncollected:${f.planId}:w${f.week}`,
    }]
  },

  /** Once a week: the agent's customers whose plans have ended with money still in them. */
  agentUncollected(f: { agentId: string; count: number; total: number; weekKey: string }): NotificationEvent[] {
    if (f.count <= 0) return []
    const title = f.count === 1 ? '1 customer hasn’t collected their money' : `${f.count} customers haven’t collected their money`
    return [{
      recipient: agent(f.agentId), kind: 'uncollected_this_week', title, body: `${naira(f.total)} is waiting in plans that have ended.`,
      href: '/dashboard/redeem', dedupeKey: `uncollected-agent:${f.agentId}:${f.weekKey}`,
    }]
  },

  /** Ajo: someone joined the agent's group. */
  ajoJoined(f: { memberId: string; agentId: string; groupId: string; groupName: string; memberName: string; count: number; size: number }): NotificationEvent[] {
    return [{ recipient: agent(f.agentId), kind: 'ajo_joined', title: `${name(f.memberName)} joined ${f.groupName}`, body: `${f.count} of ${f.size} members.`, href: `/dashboard/ajo/${f.groupId}`, dedupeKey: `ajo-joined:${f.memberId}` }]
  },

  /** Ajo: the group started; each member learns when they collect. */
  ajoStarted(f: { memberId: string; customerId: string; groupId: string; groupName: string; slotLabel: string; firstDue: string }): NotificationEvent[] {
    return [{ recipient: customer(f.customerId), kind: 'ajo_started', title: `${f.groupName} has started`, body: `You collect in ${f.slotLabel}. The first payment is due ${f.firstDue}.`, href: `/customer/ajo/${f.groupId}`, dedupeKey: `ajo-started:${f.memberId}` }]
  },

  /** Ajo: a member's payment for a round was received. The agent hears about bank transfers (cash they took themselves). */
  ajoPaid(f: { ref: string; customerId: string; agentId: string; groupId: string; groupName: string; memberName: string; roundLabel: string; amount: number; byTransfer: boolean; at?: Date }): NotificationEvent[] {
    const out: NotificationEvent[] = [{ recipient: customer(f.customerId), kind: 'ajo_paid', title: `${naira(f.amount)} paid for ${f.groupName}`, body: f.roundLabel, href: `/customer/ajo/${f.groupId}`, dedupeKey: `ajo-paid:${f.ref}`, at: f.at }]
    if (f.byTransfer) out.push({ recipient: agent(f.agentId), kind: 'ajo_paid_agent', title: `${name(f.memberName)} paid ${naira(f.amount)} for ${f.groupName}`, body: f.roundLabel, href: `/dashboard/ajo/${f.groupId}`, dedupeKey: `ajo-paid-agent:${f.ref}`, at: f.at })
    return out
  },

  /** Ajo: everyone paid a round and its holder's money is ready to collect. */
  ajoRoundOut(f: { groupId: string; round: number; agentId: string; groupName: string; roundLabel: string; holderName: string; amount: number; at?: Date }): NotificationEvent[] {
    return [{ recipient: agent(f.agentId), kind: 'ajo_round_out', title: `${f.groupName}: ${f.roundLabel} is complete`, body: `${name(f.holderName)} can collect ${naira(f.amount)}.`, href: `/dashboard/ajo/${f.groupId}`, dedupeKey: `ajo-out-agent:${f.groupId}:${f.round}`, at: f.at }]
  },

  /** Ajo: a member hasn't paid the open round and it is due (on the day, then weekly). */
  ajoDue(f: { memberId: string; customerId: string; groupId: string; groupName: string; round: number; roundLabel: string; amount: number; week: number }): NotificationEvent[] {
    return [{ recipient: customer(f.customerId), kind: 'ajo_due', title: `Your ${f.groupName} payment is due`, body: `Pay ${naira(f.amount)} for ${f.roundLabel}. The round pays out when everyone has paid.`, href: `/customer/ajo/${f.groupId}`, dedupeKey: `ajo-due:${f.memberId}:${f.round}:w${f.week}` }]
  },

  /** Ajo: tells the agent who is holding a due round up (on the day after it was due, then weekly). */
  ajoLate(f: { groupId: string; agentId: string; groupName: string; round: number; roundLabel: string; unpaid: number; week: number }): NotificationEvent[] {
    if (f.unpaid <= 0) return []
    const who = f.unpaid === 1 ? '1 member hasn’t paid' : `${f.unpaid} members haven’t paid`
    return [{ recipient: agent(f.agentId), kind: 'ajo_late', title: `${f.groupName}: ${who}`, body: `${f.roundLabel} can’t pay out until everyone has paid.`, href: `/dashboard/ajo/${f.groupId}`, dedupeKey: `ajo-late:${f.groupId}:${f.round}:w${f.week}` }]
  },

  /** Ajo: staff stopped the group. Anyone who paid the open turn has it back to collect. */
  ajoStopped(f: { memberId: string; customerId: string; groupId: string; groupName: string; refund: number }): NotificationEvent[] {
    return [{ recipient: customer(f.customerId), kind: 'ajo_stopped', title: `${f.groupName} has been stopped`, body: f.refund > 0 ? `${naira(f.refund)} you paid for this turn is ready to collect from Home.` : 'Talk to your agent if you have questions.', href: `/customer/ajo/${f.groupId}`, dedupeKey: `ajo-stopped:${f.memberId}` }]
  },

  /** Ajo: staff put someone in a member's place. Both people are told. */
  ajoReplaced(f: { memberId: string; newCustomerId: string; oldCustomerId: string; groupId: string; groupName: string; turnLabel: string; owed: number }): NotificationEvent[] {
    return [
      { recipient: customer(f.newCustomerId), kind: 'ajo_replaced', title: `You’ve joined ${f.groupName}`, body: `You collect in ${f.turnLabel} and pay every turn from now on.`, href: `/customer/ajo/${f.groupId}`, dedupeKey: `ajo-replaced-in:${f.memberId}:${f.newCustomerId}` },
      { recipient: customer(f.oldCustomerId), kind: 'ajo_replaced', title: `You’re no longer in ${f.groupName}`, body: f.owed > 0 ? `The ${naira(f.owed)} you paid comes back to you in ${f.turnLabel}.` : 'Someone else has taken your place.', href: '/customer/ajo', dedupeKey: `ajo-replaced-out:${f.memberId}:${f.oldCustomerId}` },
    ]
  },

  /** Once a day, only when there is something to say. */
  agentPlansEndingThisWeek(f: { agentId: string; count: number; dayKey: string }): NotificationEvent[] {
    if (f.count <= 0) return []
    const title = f.count === 1 ? '1 customer’s plan ends this week' : `${f.count} customers’ plans end this week`
    return [{ recipient: agent(f.agentId), kind: 'plans_ending_this_week', title, href: '/dashboard/redeem', dedupeKey: `plans-ending:${f.agentId}:${f.dayKey}` }]
  },

  newPhone(f: { type: RecipientType; id: string; deviceSessionId: string; model?: string | null }): NotificationEvent[] {
    const what = f.model?.trim() ? `${f.model.trim()}. ` : ''
    return [{
      recipient: { type: f.type, id: f.id }, kind: 'new_phone', title: 'Your account was opened on a new phone',
      body: `${what}If this wasn’t you, call your agent or Vochus straight away.`,
      href: f.type === 'agent' ? '/dashboard/settings' : '/customer/settings', dedupeKey: `new-phone:${f.deviceSessionId}`,
    }]
  },
}

type NotificationClient = { notification: Pick<Prisma.TransactionClient['notification'], 'upsert'> }

function upsertArgs(e: NotificationEvent) {
  return {
    where: { dedupeKey: e.dedupeKey },
    update: {},
    create: {
      recipientType: e.recipient.type, recipientId: e.recipient.id, kind: e.kind, title: e.title, body: e.body ?? null, href: e.href, dedupeKey: e.dedupeKey,
      ...(e.at ? { createdAt: e.at } : {}),
    },
  }
}

/** Write events inside the caller's transaction (interactive `$transaction(async tx => …)` or a plain client). */
export async function notify(client: NotificationClient, events: NotificationEvent[]): Promise<void> {
  for (const e of events) await client.notification.upsert(upsertArgs(e))
}

/** The same writes as operations, for a batch `$transaction([...])`. */
export function notificationOps<C extends NotificationClient>(client: C, events: NotificationEvent[]) {
  return events.map(e => client.notification.upsert(upsertArgs(e)))
}

/** Bell badge: hidden at 0, then 1–9, then 9+. */
export function badgeText(n: number): string | null {
  if (!(n > 0)) return null
  return n > 9 ? '9+' : String(n)
}

/** "Today, 2:15 pm" · "Yesterday, 9:03 am" · "3 Nov" · "3 Nov 2025". */
export function timeLabel(at: Date, now: Date = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(now) - day(at)) / 86_400_000)
  if (diff === 0) return `Today, ${formatTime(at)}`
  if (diff === 1) return `Yesterday, ${formatTime(at)}`
  return at.getFullYear() === now.getFullYear() ? shortDay(at) : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
