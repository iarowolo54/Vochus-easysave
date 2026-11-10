import type { PrismaClient } from '@prisma/client'
import { sendMail } from '@/lib/mail'
import { formatNaira } from '@/lib/format'
import { renderEmail } from '@/lib/email-template'
import { emailAction } from '@/lib/email-brand'

type Client = Pick<PrismaClient, 'superAdmin'>

/**
 * Email every super admin that a customer's redemption is awaiting approval.
 * Best-effort: never throws, so it is safe to fire-and-forget from a route. sendMail has no
 * environment gate of its own, so real sends happen only when NODE_ENV === 'production'.
 * The message carries no token, OTP or auth data.
 */
export async function notifySuperAdminsRedemptionPending(
  client: Client,
  input: { customerName: string; amountNaira: number; planGoal?: string; ref: string; warning?: string },
): Promise<void> {
  try {
    if (process.env.NODE_ENV !== 'production') return
    const admins = await client.superAdmin.findMany({
      where: { email: { not: '' } },
      select: { email: true },
    })
    const html = renderEmail({
      subject: 'Redemption awaiting approval',
      preheader: `${input.customerName} asked to redeem ${formatNaira(input.amountNaira)}.`,
      tone: 'warning',
      statusLabel: '',
      audience: 'staff',
      heading: 'A redemption needs your approval',
      amount: formatNaira(input.amountNaira),
      amountLabel: 'Amount',
      reason: input.warning ? { label: 'Check first', text: input.warning } : undefined,
      action: emailAction('Review redemption', '/superadmin/redemptions'),
      rows: [['Customer', input.customerName], ['Plan', input.planGoal], ['Reference', input.ref]],
    })
    for (const a of admins) {
      if (!a.email) continue
      try {
        await sendMail({ to: a.email, subject: 'Redemption awaiting approval', html })
      } catch {
        // one failed recipient must not stop the others
      }
    }
  } catch {
    // best-effort: a failed notification must never affect the redemption flow
  }
}

/** Email every super admin about a payout that needs a person to look at it. Best-effort, like the one above. */
export async function notifySuperAdminsPayoutReview(client: Client, input: { ref: string; message: string }): Promise<void> {
  try {
    if (process.env.NODE_ENV !== 'production') return
    const admins = await client.superAdmin.findMany({ where: { email: { not: '' } }, select: { email: true } })
    const html = renderEmail({
      subject: 'Payout needs manual review',
      preheader: 'A payout needs someone to look at it.',
      tone: 'warning',
      statusLabel: '',
      audience: 'staff',
      heading: 'A payout needs manual review',
      reason: { label: 'What happened', text: input.message },
      action: emailAction('Review payout', '/superadmin/redemptions'),
      rows: [['Reference', input.ref]],
    })
    for (const a of admins) {
      if (!a.email) continue
      try {
        await sendMail({ to: a.email, subject: 'Payout needs manual review', html })
      } catch {
        // one failed recipient must not stop the others
      }
    }
  } catch {
    // best-effort: a failed notification must never affect the payout flow
  }
}
