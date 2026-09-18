/* Exercise the scheduling helpers outside a browser. */
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'space4climate');
global.window = {};
new Function(fs.readFileSync(path.join(SITE, 'scheduling.js'), 'utf8'))();
const S = global.window.S4C_SCHED;

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}

console.log('\nwindowError — the rule the user asked for');
check('same date, end before start', S.windowError({ startDate: '2026-10-02', startTime: '14:00', endDate: '2026-10-02', endTime: '11:00' }), 'err.endTimeNotAfterStart');
check('same date, identical times', S.windowError({ startDate: '2026-10-02', startTime: '14:00', endDate: '2026-10-02', endTime: '14:00' }), 'err.endTimeNotAfterStart');
check('same date, end after start', S.windowError({ startDate: '2026-10-02', startTime: '14:00', endDate: '2026-10-02', endTime: '14:15' }), '');
check('later date, earlier clock time is fine', S.windowError({ startDate: '2026-10-02', startTime: '14:00', endDate: '2026-10-03', endTime: '09:00' }), '');
check('end date before start date', S.windowError({ startDate: '2026-10-02', startTime: '09:00', endDate: '2026-10-01', endTime: '23:00' }), 'err.endBeforeStart');
check('missing time', S.windowError({ startDate: '2026-10-02', startTime: '', endDate: '2026-10-02', endTime: '10:00' }), 'err.required');

console.log('\nzonedToUtc — wall clock in a zone to an instant');
check('Berlin summer (CEST, +2)', new Date(S.zonedToUtc('2026-07-01', '14:00', 'Europe/Berlin')).toISOString(), '2026-07-01T12:00:00.000Z');
check('Berlin winter (CET, +1)', new Date(S.zonedToUtc('2026-01-15', '14:00', 'Europe/Berlin')).toISOString(), '2026-01-15T13:00:00.000Z');
check('London summer (BST, +1)', new Date(S.zonedToUtc('2026-07-01', '14:00', 'Europe/London')).toISOString(), '2026-07-01T13:00:00.000Z');
check('New York summer (EDT, -4)', new Date(S.zonedToUtc('2026-07-01', '09:00', 'America/New_York')).toISOString(), '2026-07-01T13:00:00.000Z');
check('Kolkata (+5:30)', new Date(S.zonedToUtc('2026-07-01', '14:30', 'Asia/Kolkata')).toISOString(), '2026-07-01T09:00:00.000Z');
check('UTC is identity', new Date(S.zonedToUtc('2026-07-01', '14:00', 'UTC')).toISOString(), '2026-07-01T14:00:00.000Z');

console.log('\nzonedToUtc — across DST transitions');
// Europe/Berlin springs forward 2026-03-29 02:00 → 03:00.
check('Berlin, night before spring forward', new Date(S.zonedToUtc('2026-03-29', '01:00', 'Europe/Berlin')).toISOString(), '2026-03-29T00:00:00.000Z');
check('Berlin, after spring forward', new Date(S.zonedToUtc('2026-03-29', '04:00', 'Europe/Berlin')).toISOString(), '2026-03-29T02:00:00.000Z');
// Europe/Berlin falls back 2026-10-25 03:00 → 02:00.
check('Berlin, before fall back', new Date(S.zonedToUtc('2026-10-25', '01:00', 'Europe/Berlin')).toISOString(), '2026-10-24T23:00:00.000Z');
check('Berlin, after fall back', new Date(S.zonedToUtc('2026-10-25', '05:00', 'Europe/Berlin')).toISOString(), '2026-10-25T04:00:00.000Z');

console.log('\nzonedWeekHour — an instant back to weekday+hour in a zone');
// 2026-10-06 is a Tuesday (getDay() === 2).
check('Berlin 14:00 Tue reads as 2-14', S.zonedWeekHour(S.zonedToUtc('2026-10-06', '14:00', 'Europe/Berlin'), 'Europe/Berlin'), '2-14');
check('same instant in London is 2-13', S.zonedWeekHour(S.zonedToUtc('2026-10-06', '14:00', 'Europe/Berlin'), 'Europe/London'), '2-13');
check('same instant in Sydney is 2-23', S.zonedWeekHour(S.zonedToUtc('2026-10-06', '14:00', 'Europe/Berlin'), 'Australia/Sydney'), '2-23');
// Crossing midnight also crosses the weekday.
check('Berlin Mon 23:00 is Tue 06:00 in Tokyo', S.zonedWeekHour(S.zonedToUtc('2026-10-05', '23:00', 'Europe/Berlin'), 'Asia/Tokyo'), '2-06');

console.log('\nmatchRoster — teacher window vs volunteer weekly availability');
const berlinTue14to16 = { timezone: 'Europe/Berlin', slots: ['2-14', '2-15'] };
const londonTue14to16 = { timezone: 'Europe/London', slots: ['2-14', '2-15'] };
const roster = [berlinTue14to16, londonTue14to16];

// A London teacher asking for Tue 13:00–15:00 London = Tue 14:00–16:00 Berlin.
check(
  'Berlin volunteer fully covers the London window',
  S.matchRoster(roster, { startDate: '2026-10-06', startTime: '13:00', endDate: '2026-10-06', endTime: '15:00' }, 'Europe/London'),
  { full: 1, partial: 1, total: 2, hours: 2 }
);
// Asking in Berlin time instead: 15:00–17:00 Berlin is 14:00–16:00 London, so
// the London volunteer covers it outright while the Berlin one, free 14:00–16:00
// Berlin, only overlaps the first hour.
check(
  'London volunteer covers it fully, Berlin volunteer only partly',
  S.matchRoster(roster, { startDate: '2026-10-06', startTime: '15:00', endDate: '2026-10-06', endTime: '17:00' }, 'Europe/Berlin'),
  { full: 1, partial: 1, total: 2, hours: 2 }
);
// A window nobody covers.
check(
  'nobody is free at 06:00',
  S.matchRoster(roster, { startDate: '2026-10-06', startTime: '06:00', endDate: '2026-10-06', endTime: '07:00' }, 'Europe/Berlin'),
  { full: 0, partial: 0, total: 2, hours: 1 }
);
// Partial coverage: a three-hour window over two available hours.
check(
  'partial coverage counted separately',
  S.matchRoster([berlinTue14to16], { startDate: '2026-10-06', startTime: '14:00', endDate: '2026-10-06', endTime: '17:00' }, 'Europe/Berlin'),
  { full: 0, partial: 1, total: 1, hours: 3 }
);
check('empty roster', S.matchRoster([], { startDate: '2026-10-06', startTime: '14:00', endDate: '2026-10-06', endTime: '15:00' }, 'Europe/Berlin'), { full: 0, partial: 0, total: 0, hours: 1 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
