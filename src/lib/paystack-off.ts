// Paystack closed the Vochus account on 2026-11-04, so nothing may start a Paystack payment, card charge or transfer.
// This is the one switch. Every place that would begin a Paystack payment checks it and answers `paystackOff()` instead.
// Credit-only handlers that settle payments Paystack had ALREADY taken (the webhooks and the verify routes) stay on, so
// a payment that was in flight when the account closed is still credited.
//
// Typed `boolean`, not the literal `false`, so the code after each guard stays checked by the compiler.
import { NextResponse } from 'next/server'

export const PAYSTACK_ENABLED: boolean = false

export const PAYSTACK_OFF_MESSAGE = 'Card payments are switched off. Please pay by bank transfer.'

export function paystackOff() {
  return NextResponse.json({ error: PAYSTACK_OFF_MESSAGE }, { status: 410 })
}
