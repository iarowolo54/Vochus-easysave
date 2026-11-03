import { money } from '@/lib/wallet-guard'

const BASE = 'https://api.paystack.co'

function headers() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  }
}

/** Paystack answered with status:false: a definite rejection (e.g. wrong OTP), nothing was sent.
 *  Transport failures (timeout, network, bad JSON) are NOT this class: the outcome is unknown. */
export class PaystackRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaystackRejected'
  }
}

/** Paystack doesn't know this reference, so no charge was ever made with it. */
export class PaystackReferenceNotFound extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaystackReferenceNotFound'
  }
}

async function request(method: string, path: string, body?: object) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  return { httpStatus: res.status, data: await res.json() }
}

async function call(method: string, path: string, body?: object) {
  return (await request(method, path, body)).data
}

/** A status:false from a transfer call. Only a plain 4xx refusal proves nothing was sent. A 5xx, a rate limit or
 *  a timeout tells us nothing, and a duplicate reference means a transfer may already exist. */
function transferRefusal(httpStatus: number, message: string): Error {
  const refused = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429 && !/duplicate|already/i.test(message)
  return refused ? new PaystackRejected(message) : new Error(message)
}

export async function listBanks(): Promise<{ code: string; name: string }[]> {
  const data = await call('GET', '/bank?currency=NGN&perPage=200&use_cursor=false')
  if (!data.status) throw new Error(data.message ?? 'Failed to fetch banks')
  return (data.data as any[]).map(b => ({ code: b.code, name: b.name }))
}

export async function resolveAccount(accountNumber: string, bankCode: string) {
  if (bankCode === '001') {
    return { accountName: 'Test Account', accountNumber }
  }
  const { httpStatus, data } = await request('GET', `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`)
  // A PaystackRejected means this account was refused; anything else means Paystack didn't really answer.
  if (!data.status) throw transferRefusal(httpStatus, data.message ?? 'Could not resolve account')
  return { accountName: data.data.account_name as string, accountNumber: data.data.account_number as string }
}

export function isTestMode() {
  return process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')
}

export async function createRecipient(name: string, accountNumber: string, bankCode: string): Promise<string> {
  if (isTestMode()) return `RCP_test_${Date.now()}`
  const data = await call('POST', '/transferrecipient', {
    type: 'nuban',
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'NGN',
  })
  if (!data.status) throw new Error(data.message ?? 'Failed to create transfer recipient')
  return data.data.recipient_code as string
}

export interface BvnResolution {
  bvn: string
  firstName: string
  lastName: string
  middleName?: string | null
  dob?: string | null
  phone?: string | null
  gender?: string | null
}

/** Keeps the HTTP status, so a wrong key (401) can be told from an unknown BVN without logging anything from the reply. */
export class BvnLookupFailed extends Error {
  constructor(public httpStatus: number, message: string) {
    super(message)
    this.name = 'BvnLookupFailed'
  }
}

export async function resolveBvn(bvn: string): Promise<BvnResolution> {
  if (isTestMode()) {
    // Paystack test mode doesn't validate real BVNs — return a deterministic dummy
    return { bvn, firstName: 'TEST', lastName: 'CUSTOMER', dob: '1990-01-01', phone: null, gender: 'M' }
  }
  const { httpStatus, data } = await request('GET', `/bank/resolve_bvn/${bvn}`)
  if (!data.status) throw new BvnLookupFailed(httpStatus, data.message ?? 'Could not verify BVN')
  const d = data.data ?? {}
  return {
    bvn: d.bvn ?? bvn,
    firstName: (d.first_name ?? '').toString(),
    lastName: (d.last_name ?? '').toString(),
    middleName: d.middle_name ?? null,
    dob: d.formatted_dob ?? d.dob ?? null,
    phone: d.mobile ?? null,
    gender: d.gender ?? null,
  }
}

export async function initiateTransfer(amountNaira: number, recipientCode: string, reason: string, reference: string) {
  if (isTestMode()) {
    return { transferCode: `TRF_test_${Date.now()}`, status: 'success' as string, raw: null as any }
  }
  const { httpStatus, data } = await request('POST', '/transfer', {
    source: 'balance',
    reason,
    amount: Math.round(amountNaira * 100),
    recipient: recipientCode,
    reference,
  })
  if (!data.status) throw transferRefusal(httpStatus, data.message ?? 'Transfer initiation failed')
  return {
    transferCode: data.data.transfer_code as string,
    status: data.data.status as string, // 'success' | 'pending' | 'otp' | 'reversed' | 'failed'
    raw: data.data,
  }
}

export async function verifyTransfer(reference: string) {
  if (isTestMode()) return { status: 'success' as string, raw: null as any }
  const { httpStatus, data } = await request('GET', `/transfer/verify/${reference}`)
  if (!data.status) throw transferRefusal(httpStatus, data.message ?? 'Transfer verification failed')
  return { status: data.data.status as string, raw: data.data }
}

export async function finalizeTransfer(transferCode: string, otp: string) {
  if (isTestMode()) return { status: 'success' as string }
  const { httpStatus, data } = await request('POST', '/transfer/finalize_transfer', {
    transfer_code: transferCode,
    otp,
  })
  if (!data.status) {
    const message: string = data.message ?? 'OTP finalization failed'
    // Handing the claim back allows another try, so only a refusal that's clearly about the code does that.
    // Anything else is unknown: the record stays Finalizing and verify decides.
    const wrongCode = /\b(otp|code)\b/i.test(message) && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429
    throw wrongCode ? new PaystackRejected(message) : new Error(message)
  }
  // No status isn't a success: callers only book a payout on an explicit one.
  return { status: (data.data?.status ?? 'unknown') as string }
}

export interface PaystackAuthorization {
  authorization_code: string
  signature: string
  reusable: boolean
  last4?: string
  card_type?: string
  bank?: string
  exp_month?: string
  exp_year?: string
  channel?: string
}

export async function initCardAuthorization(input: {
  email: string
  amountNaira: number
  reference: string
  metadata: object
  callbackUrl?: string
}): Promise<{ authorizationUrl: string; reference: string }> {
  if (isTestMode()) {
    return { authorizationUrl: `https://checkout.paystack.test/${input.reference}`, reference: input.reference }
  }
  const data = await call('POST', '/transaction/initialize', {
    email: input.email,
    amount: Math.round(input.amountNaira * 100),
    currency: 'NGN',
    reference: input.reference,
    channels: ['card'],
    metadata: input.metadata,
    ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
  })
  if (!data.status) throw new Error(data.message ?? 'Card authorization init failed')
  return {
    authorizationUrl: data.data.authorization_url as string,
    reference: (data.data.reference ?? input.reference) as string,
  }
}

export async function chargeAuthorization(input: {
  authorizationCode: string
  email: string
  amountNaira: number
  reference: string
  metadata?: object
}): Promise<{ status: string; reference: string; gatewayResponse?: string; raw: unknown }> {
  if (isTestMode()) {
    return { status: 'success', reference: input.reference, gatewayResponse: 'Approved', raw: null }
  }
  const { httpStatus, data } = await request('POST', '/transaction/charge_authorization', {
    authorization_code: input.authorizationCode,
    email: input.email,
    amount: Math.round(input.amountNaira * 100),
    currency: 'NGN',
    reference: input.reference,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })
  if (!data.status) {
    const message = (data.message as string | undefined) ?? 'Charge refused'
    // Unknown outcome, so reconcile decides: a server error says nothing, and a duplicate means the first may have gone through.
    if (httpStatus >= 500 || /duplicate/i.test(message)) throw new Error(message)
    return { status: 'failed', reference: input.reference, gatewayResponse: message, raw: data }
  }
  return {
    status: data.data.status as string, // 'success' | 'failed' | 'pending' | ...
    reference: (data.data.reference ?? input.reference) as string,
    gatewayResponse: data.data.gateway_response as string | undefined,
    raw: data.data,
  }
}

export async function verifyTransaction(reference: string): Promise<{
  status: string
  amountNaira: number
  currency: string
  channel?: string
  authorization?: PaystackAuthorization
  gatewayResponse?: string
  raw: unknown
}> {
  if (isTestMode() && reference.startsWith('addenroll-')) {
    // test-mode hook: refs carrying 'noauth' simulate Paystack confirming the charge but returning
    // no authorization at all (the card charged once but no saveable authorization came back).
    if (reference.includes('noauth')) {
      return { status: 'success', amountNaira: 50, currency: 'NGN', channel: 'card', gatewayResponse: 'Approved', raw: null }
    }
    return {
      status: 'success',
      amountNaira: 50,
      currency: 'NGN',
      channel: 'card',
      gatewayResponse: 'Approved',
      authorization: {
        authorization_code: 'AUTH_test',
        signature: 'SIG_test',
        // test-mode hook: refs carrying 'nonreusable' simulate a non-reusable card
        reusable: !reference.includes('nonreusable'),
        last4: '4242',
        card_type: 'visa',
        bank: 'Test Bank',
        exp_month: '12',
        exp_year: '2030',
        channel: 'card',
      },
      raw: null,
    }
  }
  if (isTestMode() && (reference.startsWith('autodebit-') || reference.startsWith('VCHS-'))) {
    return { status: 'success', amountNaira: 0, currency: 'NGN', channel: 'card', gatewayResponse: 'Approved', raw: null }
  }
  const { httpStatus, data } = await request('GET', `/transaction/verify/${encodeURIComponent(reference)}`)
  if (!data.status) {
    const message = (data.message as string | undefined) ?? 'Transaction verification failed'
    // Only this exact wording, on a client error. Paystack's live wording is unconfirmed, and misreading anything else as
    // "never charged" would record a failure for a charge that may have gone through, so anything else stays unknown.
    if (httpStatus < 500 && /^transaction( reference)? not found\.?$/i.test(message.trim())) throw new PaystackReferenceNotFound(message)
    throw new Error(message)
  }
  const d = data.data
  return {
    status: d.status as string,
    amountNaira: money(Number(d.amount) / 100),
    currency: d.currency as string,
    channel: d.channel as string | undefined,
    authorization: d.authorization as PaystackAuthorization | undefined,
    gatewayResponse: d.gateway_response as string | undefined,
    raw: d,
  }
}

/** Deactivates a saved card authorization so Paystack can no longer charge it. Throws on live failure. */
export async function deactivateAuthorization(authorizationCode: string): Promise<void> {
  if (isTestMode()) return
  const data = await call('POST', '/customer/authorization/deactivate', { authorization_code: authorizationCode })
  if (!data.status) throw new Error(data.message ?? 'Authorization deactivation failed')
}
