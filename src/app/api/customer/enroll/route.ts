import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signCustomerToken, customerCookieOptions } from '@/lib/customer-auth'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'
import { resolveBvn } from '@/lib/paystack'

function genId(prefix: string, pad = 5) {
  return `${prefix}-${String(Math.floor(Math.random() * (10 ** pad - 10 ** (pad - 1)) + 10 ** (pad - 1)))}`
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { ref, aid, firstName, lastName, phone, email, dob, address, gender, bvn,
          nokName, nokRelation, nokPhone, photoUrl, dailyAmount, periodDays, goal, password, cadence, plans } = body

  if (!firstName || !lastName || !phone || !email || !address || !nokName || !nokRelation || !nokPhone || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (dailyAmount !== undefined && dailyAmount !== null && dailyAmount !== '') {
    const da = Number(dailyAmount)
    if (!isFinite(da) || da < 0) return NextResponse.json({ error: 'Daily amount cannot be negative' }, { status: 400 })
  }
  if (periodDays !== undefined && periodDays !== null && periodDays !== '') {
    const pd = Number(periodDays)
    if (!isFinite(pd) || pd <= 0) return NextResponse.json({ error: 'Period days must be a positive number' }, { status: 400 })
  }

  // If BVN was supplied, verify it matches the name with Paystack Identity.
  // Optional — empty BVN is allowed and silently skipped.
  if (bvn) {
    if (!/^\d{11}$/.test(String(bvn))) {
      return NextResponse.json({ error: 'BVN must be 11 digits' }, { status: 400 })
    }
    try {
      const r = await resolveBvn(String(bvn))
      const bvnFirst = (r.firstName ?? '').trim().toLowerCase()
      const bvnLast  = (r.lastName  ?? '').trim().toLowerCase()
      const formFirst = String(firstName).trim().toLowerCase()
      const formLast  = String(lastName).trim().toLowerCase()
      if (bvnFirst !== formFirst || bvnLast !== formLast) {
        return NextResponse.json({ error: `BVN belongs to ${r.firstName} ${r.lastName}. Your form name does not match — update or remove the BVN.` }, { status: 400 })
      }
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'BVN could not be verified — try again or leave it blank' }, { status: 400 })
    }
  }

  const invite = ref ? await prisma.customerInvite.findUnique({ where: { token: ref } }) : null

  const agent = invite
    ? await prisma.agent.findUnique({ where: { id: invite.agentId } })
    : aid
      ? await prisma.agent.findFirst({ where: { agentId: aid } })
      : null

  const agentDbId = invite?.agentId ?? agent?.id

  if (!agent || !agentDbId) {
    return NextResponse.json({ error: 'Invalid invite link — ask your agent for a new link' }, { status: 400 })
  }

  const existing = await prisma.customer.findFirst({ where: { phone } })
  if (existing) return NextResponse.json({ error: 'Phone number already registered' }, { status: 409 })

  const hashed = await bcrypt.hash(password, 10)

  let customerId = genId('CST')
  while (await prisma.customer.findUnique({ where: { customerId } })) {
    customerId = genId('CST')
  }

  const startDate = new Date()
  const rawAmt = Number(dailyAmount ?? 500)
  const actualDailyAmount = cadence === 'weekly' ? rawAmt / 7 : cadence === 'monthly' ? rawAmt / 30 : rawAmt
  const days = Number(periodDays ?? 90)
  const maturityDate = new Date(startDate)
  maturityDate.setDate(maturityDate.getDate() + days)

  const customer = await prisma.customer.create({
    data: {
      customerId,
      agentId: agentDbId,
      firstName,
      lastName,
      phone,
      email: email || null,
      dob: dob ? new Date(dob) : null,
      address,
      bvn: bvn || null,
      nokName,
      nokRelation,
      nokPhone,
      photoUrl: photoUrl || null,
      password: hashed,
      inviteToken: null,
      savingsPlans: {
        create: {
          dailyAmount: actualDailyAmount,
          periodDays: days,
          goal: goal ?? 'General Savings',
          cadence: cadence ?? 'daily',
          source: 'self',
          startDate,
          maturityDate,
          balance: 0,
          status: 'Active',
        },
      },
    },
    include: { savingsPlans: true },
  })

  if (Array.isArray(plans) && plans.length > 1) {
    for (let i = 0; i < plans.length - 1; i++) {
      const p = plans[i + 1]
      const pRawAmt = Number(p?.daily ?? p?.dailyAmount)
      const pPeriod = Number(p?.period ?? p?.periodDays)
      if (!isFinite(pRawAmt) || pRawAmt <= 0 || !isFinite(pPeriod) || pPeriod <= 0 || !p?.goal) continue
      const pCadence: string = p.cadence ?? 'daily'
      const pDaily = pCadence === 'weekly' ? pRawAmt / 7 : pCadence === 'monthly' ? pRawAmt / 30 : pRawAmt
      const pDays = pCadence === 'weekly' ? pPeriod * 7 : pCadence === 'monthly' ? pPeriod * 30 : pPeriod
      // Bump startDate by (i+1)s so (customerId, startDate) unique index doesn't collide with the first plan
      const pStart = new Date()
      pStart.setSeconds(pStart.getSeconds() + i + 1)
      const pMat = new Date(pStart); pMat.setDate(pMat.getDate() + pDays)
      await prisma.savingsPlan.create({
        data: {
          customerId: customer.id,
          dailyAmount: pDaily,
          periodDays: pDays,
          goal: p.goal,
          cadence: p.cadence ?? 'daily',
          source: 'self',
          startDate: pStart,
          maturityDate: pMat,
          balance: 0,
          status: 'Active',
        },
      })
    }
  }

  if (invite) {
    await prisma.customerInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), customerId: customer.id },
    })
  }

  const token = await signCustomerToken({
    id: customer.id,
    customerId: customer.customerId,
    name: `${customer.firstName} ${customer.lastName}`,
    agentId: agentDbId,
  })

  // Send welcome email
  if (customer.email) {
    sendMail({
      to: customer.email,
      subject: 'Welcome to Vochus Easy Save!',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#1a5c35">Welcome to Vochus Easy Save! 🎉</h2>
          <p>Hi ${customer.firstName},</p>
          <p>Your account has been successfully created. You can now start your savings journey with us!</p>
          <div style="background:#f0f8f5;border-left:4px solid #1a5c35;padding:16px;margin:20px 0;border-radius:4px">
            <div style="margin-bottom:12px">
              <strong>Your Details:</strong>
            </div>
            <div style="font-size:14px;color:#333;line-height:1.8">
              <div><strong>Customer ID:</strong> ${customer.customerId}</div>
              <div><strong>Agent:</strong> ${agent.name}</div>
              <div><strong>Daily Savings Target:</strong> ₦${customer.savingsPlans[0]?.dailyAmount?.toLocaleString() || 'N/A'}</div>
            </div>
          </div>
          <div style="text-align:center;margin:28px 0">
            <a href="${process.env.NEXTAUTH_URL ?? 'https://easysave.vochusglobalservices.co.uk'}/customer/login" style="background:#1a5c35;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Go to Dashboard →</a>
          </div>
          <p style="color:#888;font-size:12px;margin-top:24px">If you have any questions, please reach out to your agent or contact our support team.</p>
          <p style="color:#888;font-size:12px">Best regards,<br><strong>Vochus Easy Save Team</strong></p>
        </div>
      `,
    }).catch(() => {})
  }

  logAudit({
    action: 'customer_self_enrol',
    entity: 'Customer',
    entityId: customer.id,
    details: `Self-enrolment: ${customer.firstName} ${customer.lastName} (${customer.customerId}) via agent ${agent.name} — plan ₦${actualDailyAmount}/${cadence ?? 'daily'} x ${days} days`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  const res = NextResponse.json({
    customerId: customer.customerId,
    name: `${customer.firstName} ${customer.lastName}`,
    plan: customer.savingsPlans[0],
    agentName: agent.name,
  })
  res.cookies.set(customerCookieOptions(token))
  return res
}
