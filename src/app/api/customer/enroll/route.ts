import { formatNaira } from '@/lib/format'
import { emailAction } from '@/lib/email-brand'
import { emailMessage } from '@/lib/email-template'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signCustomerToken, customerCookieOptions } from '@/lib/customer-auth'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'
import { normalizeEmail } from '@/lib/email'
import { normalizePhone } from '@/lib/phone'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'
import { resolvePlanStartDate, maturityFrom } from '@/lib/saving-plan'
import { BAD_CADENCE, flexiblePlanData, getFlexibleSettings, isFlexible, parseCadence, shortDate, type FlexiblePlanData } from '@/lib/flexible-savings'
import { validatePhoto } from '@/lib/photo'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'
import { isPhoneLocked, recordLoginFailure } from '@/lib/login-attempt'
import { validateDob, validateGender, validateState, validateLga } from '@/lib/customer-fields'

const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000

/** The account this exact sign-up already created, when the password proves it's theirs; otherwise null. */
async function resumeFinishedSignUp(input: { email: string; phone: string; password: string; agentDbId: string }) {
  const existing = await prisma.customer.findFirst({
    where: {
      email: normalizeEmail(input.email),
      type: 'online',
      agentId: input.agentDbId,
      createdAt: { gte: new Date(Date.now() - RESUME_WINDOW_MS) },
    },
    select: {
      id: true, customerId: true, firstName: true, lastName: true, phone: true, password: true, status: true,
      agentId: true, tokenVersion: true,
      savingsPlans: { take: 1 },
    },
  })
  if (!existing?.password) return null
  if (normalizePhone(existing.phone) !== normalizePhone(input.phone)) return null
  if (existing.status && existing.status.toLowerCase() !== 'active') return null
  // This is a sign-in, so it obeys the sign-in lock: a locked account isn't opened here, and a wrong password
  // counts towards the lock exactly as on the sign-in screen (the caller still answers as if no account matched).
  if (await isPhoneLocked(existing.phone).catch(() => false)) return null
  if (!(await bcrypt.compare(input.password, existing.password))) {
    await recordLoginFailure({ phone: existing.phone }).catch(() => console.error('[enroll] could not record a failed resume'))
    return null
  }
  return existing
}

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
          nokName, nokRelation, nokPhone, photoUrl, dailyAmount, periodDays, goal, password, cadence, plans, startDate, endDate } = body

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
  // A photo of the customer is required (owner, Nov 2026); validatePhoto alone lets an empty one through.
  if (typeof photoUrl !== 'string' || !photoUrl) return NextResponse.json({ error: 'Take a photo of your face to continue.' }, { status: 400 })
  const photoCheck = validatePhoto(photoUrl)
  if (!photoCheck.ok) return NextResponse.json({ error: photoCheck.error }, { status: 400 })

  const dobCheck = validateDob(dob)
  if (!dobCheck.ok) return NextResponse.json({ error: dobCheck.error }, { status: 400 })

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

  // Plan types, and flexible plans' dates, are checked before anything is created.
  const mainCadence = parseCadence(cadence)
  if (!mainCadence) return NextResponse.json({ error: BAD_CADENCE }, { status: 400 })
  const extraPlans: unknown[] = Array.isArray(plans) && plans.length > 1 ? plans.slice(1) : []
  const flexSettings = await getFlexibleSettings(prisma)
  let mainFlex: FlexiblePlanData | null = null
  if (isFlexible(mainCadence)) {
    const r = flexiblePlanData({ startDate, endDate }, flexSettings)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    mainFlex = r
  }
  const extraFlex = new Map<number, FlexiblePlanData>()
  for (let i = 0; i < extraPlans.length; i++) {
    const p = extraPlans[i] as { cadence?: unknown; startDate?: unknown; endDate?: unknown } | null
    if (!p || typeof p !== 'object') continue
    const c = parseCadence(p.cadence)
    if (!c) return NextResponse.json({ error: BAD_CADENCE }, { status: 400 })
    if (isFlexible(c)) {
      const r = flexiblePlanData({ startDate: p.startDate, endDate: p.endDate }, flexSettings)
      if ('error' in r) return NextResponse.json({ error: `Plan ${i + 2}: ${r.error}` }, { status: 400 })
      extraFlex.set(i, r)
    }
  }

  if (bvn && !/^\d{11}$/.test(String(bvn))) {
    return NextResponse.json({ error: 'BVN must be 11 digits' }, { status: 400 })
  }

  const invite = typeof ref === 'string' && ref ? await prisma.customerInvite.findUnique({ where: { token: ref } }) : null

  const agent = invite
    ? await prisma.agent.findUnique({ where: { id: invite.agentId } })
    : typeof aid === 'string' && aid
      ? await prisma.agent.findFirst({ where: { agentId: aid } })
      : null

  const agentDbId = invite?.agentId ?? agent?.id

  if (!agent || !agentDbId) {
    return NextResponse.json({ error: 'Invalid invite link — ask your agent for a new link' }, { status: 400 })
  }
  // An old link must not sign anyone up under an agent who has been suspended.
  if (agent.status !== 'Active') return NextResponse.json({ error: 'This invite link is no longer active. Please contact Vochus for help.' }, { status: 400 })

  // A retry of a sign-up that already went through (the reply was lost on a weak connection, so the phone
  // never showed "You're all set"): the same email and phone, under the same agent, within a day, with the
  // password they just chose. Sign them in and answer as the first try did, instead of "already registered".
  // A wrong password falls through to the normal checks below, so this answers nothing an attacker can use.
  const resumed = await resumeFinishedSignUp({ email: String(email), phone: String(phone), password: String(password), agentDbId })
  if (resumed) {
    logAudit({
      action: 'customer_self_enrol_resumed',
      entity: 'Customer',
      entityId: resumed.id,
      details: `${resumed.firstName} ${resumed.lastName} (${resumed.customerId}) opened their account again after the first reply didn't reach them`,
      actorType: 'customer',
      actorId: resumed.id,
      actorName: `${resumed.firstName} ${resumed.lastName}`,
    })
    const token = await signCustomerToken(
      { id: resumed.id, customerId: resumed.customerId, name: `${resumed.firstName} ${resumed.lastName}`, agentId: resumed.agentId, tokenVersion: resumed.tokenVersion },
      { loginAt: Math.floor(Date.now() / 1000) },
    )
    const res = NextResponse.json({
      customerId: resumed.customerId,
      name: `${resumed.firstName} ${resumed.lastName}`,
      plan: resumed.savingsPlans[0] ?? null,
      agentName: agent.name,
    })
    res.cookies.set(customerCookieOptions(token))
    return res
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
    // `code` lets the page send them back to confirm again (a saved sign-up can outlive the confirmation).
    return NextResponse.json({ error: 'Confirm your email first', code: 'email_unconfirmed' }, { status: 400 })
  }

  // One identity, one account: the phone/email must not belong to any account.
  const conflict = await findIdentityConflict(prisma, { phone: String(phone), email: String(email) })
  if (conflict) return identityConflictResponse(conflict)

  // The BVN is optional and only kept as given: nothing looks it up, so it is not proof of who they are.

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
      type: 'online', // registered themselves
      firstName,
      lastName,
      phone: normalizePhone(String(phone)),
      email: email ? normalizeEmail(String(email)) : null,
      emailVerifiedAt: new Date(), // the email-OTP check above is required to get here
      dob: dobCheck.value,
      address,
      gender: genderCheck.value,
      state: stateCheck.value,
      lga: lgaCheck.value,
      bvn: bvn || null,
      nokName,
      nokRelation,
      nokPhone,
      photoUrl,
      password: hashed,
      inviteToken: null,
      savingsPlans: {
        create: {
          ...(mainFlex ?? { dailyAmount: actualDailyAmount, periodDays: days, cadence: mainCadence, startDate: planStart, maturityDate }),
          goal: goal ?? 'General Savings',
          source: 'self',
          balance: 0,
          status: 'Active',
        },
      },
    },
    include: { savingsPlans: true },
  })

  // Consume the email verification (all rows for this email) so it can't be reused.
  // Only the verified row, so the daily send count onboarding shares isn't reset.
  await prisma.emailOTP.deleteMany({ where: { email: normEmail, verified: true } })

  if (Array.isArray(plans) && plans.length > 1) {
    for (let i = 0; i < plans.length - 1; i++) {
      const p = plans[i + 1]
      const flex = extraFlex.get(i)
      if (flex) {
        if (!p?.goal) continue
        await prisma.savingsPlan.create({ data: { customerId: customer.id, ...flex, goal: p.goal, source: 'self', balance: 0, status: 'Active' } })
        continue
      }
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
          cadence: parseCadence(p.cadence) ?? 'daily',
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
      tokenVersion: customer.tokenVersion,
    },
    { loginAt: Math.floor(Date.now() / 1000) },
  )

  // Send welcome email
  if (customer.email) {
    sendMail({
      to: customer.email,
      ...emailMessage({
        subject: 'Welcome to Vochus Easy Save!',
        preheader: 'Your savings account is ready.',
        tone: 'success',
        statusLabel: '',
        heading: `Welcome to Vochus Easy Save, ${customer.firstName}`,
        intro: 'Your account has been created. You can now start saving.',
        action: emailAction('Open Vochus Easy Save', '/customer/login'),
        rows: [
          ['Customer ID', customer.customerId],
          ['Agent', agent.name],
          mainFlex ? ['Plan', `Flexible, until ${shortDate(mainFlex.maturityDate)}`] : ['Saving', `${formatNaira(rawAmt)} ${mainCadence}`],
        ],
      }),
    }).catch(() => {})
  }

  logAudit({
    action: 'customer_self_enrol',
    entity: 'Customer',
    entityId: customer.id,
    details: `Self-enrolment: ${customer.firstName} ${customer.lastName} (${customer.customerId}) via agent ${agent.name} — plan ${mainFlex ? `flexible, ${shortDate(mainFlex.startDate)} to ${shortDate(mainFlex.maturityDate)}` : `₦${actualDailyAmount}/${mainCadence} x ${days} days`}`,
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
