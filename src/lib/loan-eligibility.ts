// Server-side loan-request eligibility rules.
//
// These two rules previously lived only in the loan-request page, so a crafted
// request to POST /api/loans could skip them. They are business rules about
// real money, so they must be enforced server-side as well.
//
//   - A customer may borrow at most 80% of what they have saved
//     (sum of their Active savings-plan balances).
//   - A customer may hold only one active loan at a time
//     (a loan in Disbursed / Pending / Approved state).
//
// `savingsBalance` and `hasActiveLoan` are computed exactly as the customers
// endpoint computes them, so the API and the page agree on the numbers.

import type { Prisma, PrismaClient } from '@prisma/client'

export const LOAN_LIMIT_FRACTION = 0.8

// Loan states that count as "the customer already has a loan" — matches the
// set the customers endpoint uses to surface `activeLoan`.
export const ACTIVE_LOAN_STATUSES = ['Disbursed', 'Pending', 'Approved'] as const

export type LoanEligibilityInput = {
  principal: number
  savingsBalance: number
  hasActiveLoan: boolean
}

export type LoanEligibilityResult = { ok: true } | { ok: false; error: string }

export function checkLoanEligibility(input: LoanEligibilityInput): LoanEligibilityResult {
  const { principal, savingsBalance, hasActiveLoan } = input

  // Active-loan rule first: it tells the agent the actual next step (repay the
  // existing loan) rather than an amount they can't satisfy anyway.
  if (hasActiveLoan) {
    return { ok: false, error: 'This customer already has a loan. It must be repaid before they can take another.' }
  }

  const maxLoan = savingsBalance * LOAN_LIMIT_FRACTION
  if (maxLoan <= 0) {
    return { ok: false, error: 'This customer has no savings to borrow against.' }
  }
  if (principal > maxLoan) {
    return { ok: false, error: `The most this customer can borrow is 80% of their savings (${maxLoan}).` }
  }

  return { ok: true }
}

// Loads the figures the eligibility check needs, scoped to the acting agent.
// Returns null when the customer is not owned by this agent (closes the IDOR
// at the same point the rule is enforced).
export async function loadLoanEligibilityContext(
  client: Pick<PrismaClient, 'customer'>,
  agentDbId: string,
  customerId: string,
): Promise<{ savingsBalance: number; hasActiveLoan: boolean } | null> {
  const customer = await client.customer.findFirst({
    where: { id: customerId, agentId: agentDbId },
    include: {
      savingsPlans: { where: { status: 'Active' }, select: { balance: true } },
      loans: { where: { status: { in: [...ACTIVE_LOAN_STATUSES] } }, select: { id: true }, take: 1 },
    },
  })
  if (!customer) return null

  const savingsBalance = customer.savingsPlans.reduce((s, p) => s + p.balance, 0)
  const hasActiveLoan = customer.loans.length > 0
  return { savingsBalance, hasActiveLoan }
}

// Disburse-time guard for the one-loan rule. The request-time check in
// POST /api/loans is a non-atomic read, so a race can leave a customer with two
// Pending loans that an admin may both approve. Called inside the disburse
// transaction (pass the tx client) BEFORE claiming the loan, this makes the
// rule unbypassable at the money boundary: a second payout for a customer who
// already has a Disbursed loan is refused. `excludeLoanId` is the loan being
// disbursed, so it never counts itself.
export async function customerHasOtherDisbursedLoan(
  client: Prisma.TransactionClient | Pick<PrismaClient, 'loan'>,
  customerId: string,
  excludeLoanId: string,
): Promise<boolean> {
  const count = await client.loan.count({
    where: { customerId, id: { not: excludeLoanId }, status: 'Disbursed' },
  })
  return count > 0
}
