import type { PrismaClient } from '@prisma/client'
import { sendMail } from '@/lib/mail'
import { formatNaira } from '@/lib/format'

type Client = Pick<PrismaClient, 'superAdmin'>

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

/**
 * Email every super admin that a customer's redemption is awaiting approval.
 * Best-effort: never throws, so it is safe to fire-and-forget from a route. sendMail has no
 * environment gate of its own, so real sends happen only when NODE_ENV === 'production'.
 * The message carries no token, OTP or auth data.
 */
export async function notifySuperAdminsRedemptionPending(
  client: Client,
  input: { customerName: string; amountNaira: number; planGoal?: string; ref: string },
): Promise<void> {
  try {
    if (process.env.NODE_ENV !== 'production') return
    const admins = await client.superAdmin.findMany({
      where: { email: { not: '' } },
      select: { email: true },
    })
    const html =
      `<p>A customer redemption is awaiting admin approval.</p>` +
      `<p>Customer: <strong>${escapeHtml(input.customerName)}</strong><br/>` +
      `Amount: <strong>${escapeHtml(formatNaira(input.amountNaira))}</strong><br/>` +
      (input.planGoal ? `Plan: ${escapeHtml(input.planGoal)}<br/>` : '') +
      `Reference: <code>${escapeHtml(input.ref)}</code></p>` +
      `<p>Open the admin dashboard to review and approve it.</p>`
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
