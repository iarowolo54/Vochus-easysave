import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signCustomerToken, customerCookieOptions } from '@/lib/customer-auth'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'
import { resolveBvn } from '@/lib/paystack'
import { bvnNameMatches, refuseBvnLookup } from '@/lib/bvn-lookup'
import { normalizeEmail } from '@/lib/email'
import { normalizePhone } from '@/lib/phone'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'
import { resolvePlanStartDate, maturityFrom } from '@/lib/saving-plan'
import { validatePhoto } from '@/lib/photo'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'
import { validateGender, validateState, validateLga } from '@/lib/customer-fields'

function genId(prefix: string, pad = 5) {
  return `${prefix}-${String(Math.floor(Math.random() * (10 ** pad - 10 ** (pad - 1)) + 10 ** (pad - 1)))}`
}

export async function POST(req: NextRequest) {
  // FIRST: bound every attempt per IP (before parsing, the OTP gate and the
  // identity guard) so the 409 cannot be used to enumerate accounts at volume.
  const ipLimit = enrolRateLimiter.check(`enroll:ip:${clientIp(req)}`, 10, 60 * 60 * 1000)
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
  }

  const body = await req.json()
  const { ref, aid, firstName, lastName, phone, email, dob, address, gender, state, lga, bvn,
          nokName, nokRelation, nokPhone, photoUrl, dailyAmount, periodDays, goal, password, cadence, plans, startDate } = body

  if (!firstName || !lastName || !phone || !email || !address || !nokName || !nokRelation || !nokPhone || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Field rules — the server now enforces what the UI enforces, so a direct
  // POST can't bypass them. (Request/response shape is unchanged.)
  if (!/^0\d{10}$/.test(String(phone))) {
    return NextResponse.json({ error: 'Phone must be 11 digits starting with 0' }, { status: 400 })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }
  if (String(address).trim().length < 8) {
    return NextResponse.json({ error: 'Address must be at least 8 characters' }, { status: 400 })
  }
  if (String(nokPhone) === String(phone)) {
    return NextResponse.json({ error: "Emergency contact's phone must be different from the customer's" }, { status: 400 })
  }
  if (String(password).length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }
  const photoCheck = validatePhoto(photoUrl)
  if (!photoCheck.ok) return NextResponse.json({ error: photoCheck.error }, { status: 400 })

  // Gender, state and LGA are required; the LGA must belong to the state (#18).
  const genderCheck = validateGender(gender)
  if (!genderCheck.ok) return NextResponse.json({ error: genderCheck.error }, { status: 400 })
  const stateCheck = validateState(state)
  if (!stateCheck.ok) return NextResponse.json({ error: stateCheck.error }, { status: 400 })
  const lgaCheck = validateLga(stateCheck.value, lga)
  if (!lgaCheck.ok) return NextResponse.json({ error: lgaCheck.error }, { status: 400 })
  if (dailyAmount !== undefined && dailyAmount !== null && dailyAmount !== '') {
    const da = Number(dailyAmount)
    if (!isFinite(da) || da < 0) return NextResponse.json({ error: 'Daily amount cannot be negative' }, { status: 400 })
  }
  if (periodDays !== undefined && periodDays !== null && periodDays !== '') {
    const pd = Number(periodDays)
    if (!isFinite(pd) || pd <= 0) return NextResponse.json({ error: 'Period days must be a positive number' }, { status: 400 })
  }

  if (bvn && !/^\d{11}$/.test(String(bvn))) {
    return NextResponse.json({ error: 'BVN must be 11 digits' }, { status: 400 })
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

  // Email must have been verified via the email-OTP flow, recently. This is the
  // server-side gate — the browser check alone is not enough. The row is
  // consumed after the customer is created so it can't be replayed.
  const normEmail = normalizeEmail(String(email))
  const emailThirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000)
  const verifiedOtp = await prisma.emailOTP.findFirst({
    where: { email: normEmail, verified: true, createdAt: { gte: emailThirtyMinAgo } },
    orderBy: { createdAt: 'desc' },
  })
  if (!verifiedOtp) {
    return NextResponse.json({ error: 'Confirm your email first' }, { status: 400 })
  }

  // One identity, one account: the phone/email must not belong to any account.
  const conflict = await findIdentityConflict(prisma, { phone: String(phone), email: String(email) })
  if (conflict) return identityConflictResponse(conflict)

  // If BVN was supplied, verify it matches the name with Paystack Identity. Optional: empty is skipped.
  // After the email gate and on the same budget as /api/identity/bvn, and it never names the BVN's owner.
  if (bvn) {
    const refused = await refuseBvnLookup(normEmail, clientIp(req))
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status })
    try {
      const r = await resolveBvn(String(bvn))
      if (!bvnNameMatches(r, { firstName: String(firstName), lastName: String(lastName) })) {
        return NextResponse.json({ error: 'This BVN doesn’t match the name you entered. Check your name, or remove the BVN to carry on without it.' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'BVN could not be verified — try again or leave it blank' }, { status: 400 })
    }
  }

  const hashed = await bcrypt.hash(password, 10)

  let customerId = genId('CST')
  while (await prisma.customer.findUnique({ where: { customerId } })) {
    customerId = genId('CST')
  }

  // Optional start date (today or later) for the first plan; defaults to today.
  const started = resolvePlanStartDate(startDate)
  if ('error' in started) return NextResponse.json({ error: started.error }, { status: 400 })
  const planStart = started.date
  const rawAmt = Number(dailyAmount ?? 500)
  const actualDailyAmount = cadence === 'weekly' ? rawAmt / 7 : cadence === 'monthly' ? rawAmt / 30 : rawAmt
  const days = Number(periodDays ?? 90)
  const maturityDate = maturityFrom(planStart, days)

  const customer = await prisma.customer.create({
    data: {
      customerId,
      agentId: agentDbId,
      firstName,
      lastName,
      phone: normalizePhone(String(phone)),
      email: email ? normalizeEmail(String(email)) : null,
      dob: dob ? new Date(dob) : null,
      address,
      gender: genderCheck.value,
      state: stateCheck.value,
      lga: lgaCheck.value,
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
          startDate: planStart,
          maturityDate,
          balance: 0,
          status: 'Active',
        },
      },
    },
    include: { savingsPlans: true },
  })

  // Consume the email verification (all rows for this email) so it can't be reused.
  await prisma.emailOTP.deleteMany({ where: { email: normEmail } })

  if (Array.isArray(plans) && plans.length > 1) {
    for (let i = 0; i < plans.length - 1; i++) {
      const p = plans[i + 1]
      const pRawAmt = Number(p?.daily ?? p?.dailyAmount)
      const pPeriod = Number(p?.period ?? p?.periodDays)
      if (!isFinite(pRawAmt) || pRawAmt <= 0 || !isFinite(pPeriod) || pPeriod <= 0 || !p?.goal) continue
      const pCadence: string = p.cadence ?? 'daily'
      const pDaily = pCadence === 'weekly' ? pRawAmt / 7 : pCadence === 'monthly' ? pRawAmt / 30 : pRawAmt
      const pDays = pCadence === 'weekly' ? pPeriod * 7 : pCadence === 'monthly' ? pPeriod * 30 : pPeriod
      // Optional per-plan start date (today or later); defaults to today. Plans
      // may now share a start date — the (customerId, startDate) unique index is gone.
      const pStarted = resolvePlanStartDate(p?.startDate)
      if ('error' in pStarted) continue
      const pStart = pStarted.date
      const pMat = maturityFrom(pStart, pDays)
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

  const token = await signCustomerToken(
    {
      id: customer.id,
      customerId: customer.customerId,
      name: `${customer.firstName} ${customer.lastName}`,
      agentId: agentDbId,
    },
    { loginAt: Math.floor(Date.now() / 1000) },
  )

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
