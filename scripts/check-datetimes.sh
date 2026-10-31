#!/usr/bin/env bash
# check-datetimes.sh — scan a Prisma + SQLite database for malformed DateTime values.
#
# WHY: Prisma stores every DateTime in this SQLite DB as an epoch-millisecond INTEGER
# (e.g. 1791149794000). A value hand-inserted as SQLite text — "2026-10-04 21:36:34"
# (the CURRENT_TIMESTAMP / datetime() format, with a space and no 'T') — is unparseable
# by Prisma and throws P2023 "Inconsistent column data" on ANY query that reads it,
# 500-ing the page (e.g. the agent dashboard's transaction.groupBy). Run this before
# AND after any manual SQL edit to the database.
#
# USAGE:
#   ./scripts/check-datetimes.sh [path-to-dev.db]
# Default path is the production DB on the server. Run it over ssh like:
#   ssh administrator@69.197.164.193 'bash -s' < scripts/check-datetimes.sh
#
# EXIT: 0 = clean, 1 = malformed values found (prints them + the fix), 2 = DB not found.

set -euo pipefail
DB="${1:-$HOME/vochus-easysave/prisma/dev.db}"
[ -f "$DB" ] || { echo "❌ DB not found: $DB"; exit 2; }
command -v sqlite3 >/dev/null || { echo "❌ sqlite3 not installed"; exit 2; }

echo "🔎 Scanning DateTime columns in: $DB"
bad=0
scanned=0

# Every table × every DATETIME-typed column (Prisma declares DateTime as DATETIME).
while IFS='|' read -r tbl col; do
  [ -n "$tbl" ] || continue
  scanned=$((scanned + 1))
  # typeof=text catches ONLY the bad SQLite-string values; valid epoch-ms rows are 'integer'.
  n=$(sqlite3 "$DB" "SELECT count(*) FROM \"$tbl\" WHERE typeof(\"$col\")='text' AND \"$col\" LIKE '% %';")
  if [ "${n:-0}" -gt 0 ]; then
    bad=$((bad + n))
    echo "⚠️  $tbl.$col — $n malformed value(s):"
    sqlite3 "$DB" "SELECT '      rowid=' || rowid || '   ' || \"$col\" FROM \"$tbl\" WHERE typeof(\"$col\")='text' AND \"$col\" LIKE '% %' LIMIT 5;"
  fi
done < <(sqlite3 "$DB" "SELECT m.name || '|' || p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND upper(p.type)='DATETIME';")

echo "   scanned $scanned DateTime column(s)."
if [ "$bad" -eq 0 ]; then
  echo "✅ No malformed DateTime values found."
  exit 0
fi
echo ""
echo "❌ $bad malformed DateTime value(s). Fix each flagged column with (preserves the time):"
echo "   UPDATE \"<table>\" SET \"<col>\" = CAST(strftime('%s', \"<col>\") AS INTEGER)*1000 WHERE typeof(\"<col>\")='text' AND \"<col>\" LIKE '% %';"
echo "   (Back up first: sqlite3 \"$DB\" \".backup ~/db-backups/manualfix-\$(date -u +%Y%m%d-%H%M%S).db\")"
exit 1
