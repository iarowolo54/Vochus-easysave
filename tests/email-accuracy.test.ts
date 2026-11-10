// Unit test: what the emails say has to be true for the person reading them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWeeklySummary } from '../src/lib/weekly-summary'
import { codeEmailMessage } from '../src/lib/email-template'

const asOf = new Date('2026-11-10T12:00:00Z')
const day = 24 * 60 * 60 * 1000
const plan = (daysLeft: number, interestAccrued = 0) => ({ balance: 1000, maturityDate: new Date(asOf.getTime() + daysLeft * day), interestAccrued, status: 'Active' })
const summary = (plans: ReturnType<typeof plan>[]) => buildWeeklySummary({ firstName: 'Ada', plans, weekDeposits: [{ amount: 300 }], asOf }).emailHtml

test('a plan that has ended is not counted as the next one to end', () => {
  const html = summary([plan(-20), plan(12)])
  assert.ok(html.includes('12 days'))
  assert.ok(!html.includes('0 days'))
})

test('when every plan has ended, the line is left out', () => {
  assert.ok(!summary([plan(-20)]).includes('Next plan ends in'))
})

test('a saver with no interest is not shown a line of zero', () => {
  assert.ok(!summary([plan(5)]).includes('Interest earned'))
  assert.ok(summary([plan(5, 15)]).includes('Interest earned'))
})

test('the weekly text only mentions interest when there is some', () => {
  const sms = (interest: number) => buildWeeklySummary({ firstName: 'Ada', plans: [plan(5, interest)], weekDeposits: [{ amount: 300 }], asOf }).smsText
  assert.ok(!sms(0).includes('Interest'))
  assert.ok(sms(15).includes('Interest earned NGN 15'))
})

test('a code never appears in the inbox preview', () => {
  const { html } = codeEmailMessage({ subject: 'Code', preheader: 'Use this code.', heading: 'Code', code: '482913', caption: 'Expires soon.' })
  const preview = html.slice(html.indexOf('<body'), html.indexOf('<table'))
  assert.ok(!preview.includes('482913'))
  assert.ok(html.includes('482913'))
})
