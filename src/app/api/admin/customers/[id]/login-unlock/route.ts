import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { isPhoneLocked, unlockAccount } from '@/lib/login-attempt'
import { readBody } from '@/lib/password-reset'

// Clears the lock from too many wrong passwords, for someone a stranger keeps locked out. Doesn't change
// the password or the Locked status an admin sets, and an account that isn't locked writes no audit entry.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const body = await readBody(req)
  const pinCheck = await verifyApprovalPin(guard.session, body.pin)
  if (!pinCheck.ok) return pinCheck.response

  const { id } = await params
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, phone: true, firstName: true, lastName: true, customerId: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  if (!(await isPhoneLocked(customer.phone))) return NextResponse.json({ cleared: false })

  await unlockAccount(customer.phone)
  await logAudit({
    action: 'customer_login_lock_cleared',
    entity: 'Customer',
    entityId: customer.id,
    details: `Cleared the sign-in lock for ${customer.firstName} ${customer.lastName} (${customer.customerId})`,
    actorType: 'admin',
    ...adminActor(guard.session),
  })

  return NextResponse.json({ cleared: true })
}
