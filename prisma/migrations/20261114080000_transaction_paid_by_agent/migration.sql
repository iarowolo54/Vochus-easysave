-- Marks a deposit an agent paid into an ONLINE customer's plan from the agent wallet, so every record shows it as the
-- agent's payment. One added nullable column: existing rows are untouched.
ALTER TABLE "Transaction" ADD COLUMN "paidByAgentId" TEXT;
