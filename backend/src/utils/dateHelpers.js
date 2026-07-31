/**
 * dateHelpers.js
 *
 * Pure, DB-free date-math helpers shared across:
 *   - dateMiddleware.js          (deadline enforcement)
 *   - configController.js        (extension ceiling computation)
 *   - deadlineResolver.js        (effective-deadline resolution)
 *   - raController.js            (missed-deadlines aggregation)
 *
 * These were previously duplicated inside dateMiddleware.js.
 * Centralised here so any fix or extension is applied once.
 *
 * GO_LIVE — the earliest month for which the system tracks plan/achievement
 * obligations. Any month *before* this floor is skipped in aggregate queries.
 * Keep this in sync with the matching constant in the frontend
 * (RAMonthlyEvaluationPage / ExtendDeadlineManagementPage).
 */

/** Earliest month the system tracks (inclusive). */
const GO_LIVE = { year: 2026, month: 5 }; // May 2026

/* ════════════════════════════════════════════════════════════════════
   HELPER — Returns ordinal suffix for a day number.
   e.g. 1 → "st", 2 → "nd", 3 → "rd", 10 → "th"
════════════════════════════════════════════════════════════════════ */
function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — human-readable description of a (day, monthOffset) deadline,
   e.g. (10, 0) → "the 10th of that month"
        (3, 1)  → "the 3rd of the following month"
        ("last", 1) → "the last day of the following month"
   Used to build clear, role-aware error messages.
════════════════════════════════════════════════════════════════════ */
function describeDeadline(day, monthOffset) {
  const dayLabel =
    day === "last" ? "the last day" : `the ${day}${getOrdinalSuffix(day)}`;
  let monthLabel;
  if (monthOffset === 0) monthLabel = "of that month";
  else if (monthOffset === 1) monthLabel = "of the following month";
  else monthLabel = `of the month ${monthOffset} months later`;
  return `${dayLabel} ${monthLabel}`;
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — add `offset` calendar months to a (year, month) pair,
   normalising month overflow into the year (month is 1-12).
   e.g. (2026, 12, offset=1) → { year: 2027, month: 1 }
════════════════════════════════════════════════════════════════════ */
function addCalendarMonths(year, month, offset) {
  const zeroBasedTotal = month - 1 + offset;
  const newYear = year + Math.floor(zeroBasedTotal / 12);
  const newMonth = (zeroBasedTotal % 12) + 1;
  return { year: newYear, month: newMonth };
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — last calendar day of a given (year, month), month is 1-12.
════════════════════════════════════════════════════════════════════ */
function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate(); // JS Date month is 0-based
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — builds a concrete Date for (year, month, day, monthOffset).
   `day` may be "last" (resolves to that target month's last day) or a
   1-31 integer (clamped to the target month's real last day, e.g. day
   31 in a 30-day month safely resolves to the 30th).
════════════════════════════════════════════════════════════════════ */
function buildDeadlineDate(year, month, day, monthOffset, endOfDay) {
  const { year: y, month: m } = addCalendarMonths(year, month, monthOffset);
  const lastDay = getLastDayOfMonth(y, m);
  const resolvedDay = day === "last" ? lastDay : Math.min(day, lastDay);

  return endOfDay
    ? new Date(y, m - 1, resolvedDay, 23, 59, 59, 999)
    : new Date(y, m - 1, resolvedDay, 0, 0, 0, 0);
}

module.exports = {
  GO_LIVE,
  getOrdinalSuffix,
  describeDeadline,
  addCalendarMonths,
  getLastDayOfMonth,
  buildDeadlineDate,
};
