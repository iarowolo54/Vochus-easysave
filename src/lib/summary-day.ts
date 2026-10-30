/** Weekly summaries go out on Fridays (server-local day, matching the daily cron's clock). */
export function isSummaryDay(d: Date): boolean {
  return d.getDay() === 5
}
