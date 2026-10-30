-- CreateIndex
CREATE INDEX "AutoDebitAttempt_status_createdAt_idx" ON "AutoDebitAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutoDebitMandate_status_nextRunAt_idx" ON "AutoDebitMandate"("status", "nextRunAt");
