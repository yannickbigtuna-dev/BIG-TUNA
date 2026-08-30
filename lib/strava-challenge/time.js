'use strict';

const CHALLENGE_TIME_ZONE = 'America/Halifax';
const formatterCache = new Map();

function formatter(tz) {
  if (!formatterCache.has(tz)) formatterCache.set(tz, new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return formatterCache.get(tz);
}
function getZonedParts(date, tz = CHALLENGE_TIME_ZONE) {
  const fields = Object.fromEntries(formatter(tz).formatToParts(new Date(date)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year: +fields.year, month: +fields.month, day: +fields.day, hour: +fields.hour, minute: +fields.minute, second: +fields.second };
}
function zonedDateTimeToUtc(parts, tz = CHALLENGE_TIME_ZONE) {
  // Re-resolve after applying the offset: this also handles Halifax DST changes.
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const seen = getZonedParts(new Date(guess), tz);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    const next = guess + target - seenUtc;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
function dateKey(parts) { return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`; }
function addCalendarDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
function getWeekBounds(input = new Date(), tz = CHALLENGE_TIME_ZONE) {
  const p = getZonedParts(input, tz); const utcDay = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const monday = addCalendarDays(p, -((utcDay + 6) % 7));
  const nextMonday = addCalendarDays(monday, 7);
  const start = zonedDateTimeToUtc({ ...monday, hour: 0, minute: 0, second: 0 }, tz);
  const end = zonedDateTimeToUtc({ ...nextMonday, hour: 0, minute: 0, second: 0 }, tz);
  return { weekStart: dateKey(monday), start, end, endInclusive: new Date(end.getTime() - 1) };
}
function getPreviousWeekBounds(input = new Date(), tz = CHALLENGE_TIME_ZONE) { return getWeekBounds(new Date(getWeekBounds(input, tz).start.getTime() - 1), tz); }
function getChallengeRange(config = {}, now = new Date(), tz = CHALLENGE_TIME_ZONE) {
  const year = Number(config.challengeYear || config.year || getZonedParts(now, tz).year);
  const configuredStart = String(config.challengeStart || config.challengeStartDate || '');
  const matchedStart = configuredStart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const startParts = matchedStart && Number(matchedStart[1]) === year
    ? { year, month: Number(matchedStart[2]), day: Number(matchedStart[3]) }
    : { year, month: 1, day: 1 };
  const start = zonedDateTimeToUtc({ ...startParts, hour: 0, minute: 0, second: 0 }, tz);
  const end = zonedDateTimeToUtc({ year: year + 1, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, tz);
  return { year, start, end };
}
function formatWeekDateRange(bounds, tz = CHALLENGE_TIME_ZONE) {
  const a = getZonedParts(bounds.start || bounds, tz), b = getZonedParts(bounds.endInclusive || new Date(bounds.end.getTime() - 1), tz);
  const opts = { timeZone: tz, month: 'short', day: 'numeric' };
  const fa = new Intl.DateTimeFormat('en-CA', opts).format(new Date(bounds.start || bounds));
  const fb = new Intl.DateTimeFormat('en-CA', opts).format(new Date(bounds.endInclusive || new Date(bounds.end.getTime() - 1)));
  return a.year === b.year ? `${fa}–${fb}` : `${fa}, ${a.year}–${fb}, ${b.year}`;
}
function isMondayFinalizationDue(now = new Date(), hour = 8, tz = CHALLENGE_TIME_ZONE) { const p = getZonedParts(now, tz); return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() === 1 && p.hour >= hour; }
module.exports = { CHALLENGE_TIME_ZONE, getZonedParts, zonedDateTimeToUtc, getWeekBounds, getPreviousWeekBounds, getChallengeRange, formatWeekDateRange, isMondayFinalizationDue };
