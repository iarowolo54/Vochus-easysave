// Unit tests for the pure month-grid logic behind the date picker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  monthView, leadingBlanks, daysInMonth, canGoPrev, canGoNext, stepMonth, initialView, isSelectable,
  MONTH_NAMES, WEEKDAYS,
} from '../src/lib/calendar'

const d = (y: number, m: number, day: number) => new Date(y, m, day)

test('Monday-first leading blanks: Nov 2026 starts on a Sunday → 6 blanks', () => {
  // 2026-11-01 is a Sunday.
  assert.equal(new Date(2026, 10, 1).getDay(), 0)
  assert.equal(leadingBlanks(2026, 10), 6)
})

test('Monday-first leading blanks: a month starting Monday → 0 blanks', () => {
  // 2026-06-01 is a Monday.
  assert.equal(new Date(2026, 5, 1).getDay(), 1)
  assert.equal(leadingBlanks(2026, 5), 0)
})

test('daysInMonth handles Feb leap/non-leap', () => {
  assert.equal(daysInMonth(2026, 1), 28) // Feb 2026
  assert.equal(daysInMonth(2028, 1), 29) // Feb 2028 (leap)
  assert.equal(daysInMonth(2026, 0), 31) // Jan
})

test('monthView: day count, title, today & selected flags', () => {
  const v = monthView(2026, 10, { today: d(2026, 10, 5), selectedIso: '2026-11-20' })
  assert.equal(v.days.length, 30)
  assert.equal(v.title, 'November 2026')
  assert.equal(v.leadingBlanks, 6)
  assert.equal(v.days.find(x => x.day === 5)?.isToday, true)
  assert.equal(v.days.find(x => x.day === 6)?.isToday, false)
  assert.equal(v.days.find(x => x.day === 20)?.isSelected, true)
  assert.equal(v.days.find(x => x.day === 19)?.isSelected, false)
})

test('monthView: min disables earlier days, enables today and after (plan start = today..∞)', () => {
  const today = d(2026, 10, 10)
  const v = monthView(2026, 10, { today, minIso: '2026-11-10' })
  assert.equal(v.days.find(x => x.day === 9)?.disabled, true, 'day before min disabled')
  assert.equal(v.days.find(x => x.day === 10)?.disabled, false, 'min day enabled')
  assert.equal(v.days.find(x => x.day === 11)?.disabled, false, 'after min enabled')
})

test('monthView: max disables later days (DOB = ..today)', () => {
  const v = monthView(2026, 10, { today: d(2026, 10, 15), maxIso: '2026-11-15' })
  assert.equal(v.days.find(x => x.day === 15)?.disabled, false, 'max day enabled')
  assert.equal(v.days.find(x => x.day === 16)?.disabled, true, 'after max disabled')
})

test('canGoPrev: false at the min month, true the month after', () => {
  // min in November 2026 → cannot step back from November, can step back from December.
  assert.equal(canGoPrev(2026, 10, '2026-11-10'), false)
  assert.equal(canGoPrev(2026, 11, '2026-11-10'), true)
  assert.equal(canGoPrev(2026, 10, null), true) // no min → always allowed
})

test('canGoNext: false at the max month, true the month before', () => {
  assert.equal(canGoNext(2026, 10, '2026-11-10'), false)
  assert.equal(canGoNext(2026, 9, '2026-11-10'), true)
  assert.equal(canGoNext(2026, 10, null), true)
})

test('stepMonth wraps year boundaries', () => {
  assert.deepEqual(stepMonth(2026, 11, 1), { year: 2027, month: 0 })
  assert.deepEqual(stepMonth(2026, 0, -1), { year: 2025, month: 11 })
})

test('initialView: opens on selected clamped into range, else today', () => {
  const today = d(2026, 10, 5)
  assert.deepEqual(initialView({ today, selectedIso: '2027-02-03' }), { year: 2027, month: 1 })
  assert.deepEqual(initialView({ today, selectedIso: null }), { year: 2026, month: 10 })
  // selected below min clamps up to min's month
  assert.deepEqual(initialView({ today, selectedIso: '2020-01-01', minIso: '2026-11-01' }), { year: 2026, month: 10 })
})

test('isSelectable respects min and max (and open ends)', () => {
  assert.equal(isSelectable('2026-11-10', '2026-11-10', null), true)  // == min ok
  assert.equal(isSelectable('2026-11-09', '2026-11-10', null), false) // below min
  assert.equal(isSelectable('2026-11-15', null, '2026-11-15'), true)  // == max ok
  assert.equal(isSelectable('2026-11-16', null, '2026-11-15'), false) // above max
  assert.equal(isSelectable('2026-11-12', null, null), true)          // no bounds
  assert.equal(isSelectable('not-a-date', null, null), false)
})

test('exports sane headers', () => {
  assert.equal(WEEKDAYS.length, 7)
  assert.equal(WEEKDAYS[0], 'Mo')
  assert.equal(MONTH_NAMES.length, 12)
})
