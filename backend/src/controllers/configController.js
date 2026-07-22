/**
 * configController.js
 *
 * Exposes the monthly submission deadline configuration that is stored in
 * environment variables.  This is the SINGLE source of truth consumed by
 * both the date-enforcement middleware (backend) and the React deadline
 * context (frontend).
 *
 * ENV VARS (set in backend/.env):
 *   MONTHLY_PLAN_DEADLINE_DAY          integer 1-31             default: 10
 *   MONTHLY_ACHIEVEMENT_START_DAY      integer 1-31             default: planDay + 1
 *   MONTHLY_ACHIEVEMENT_DEADLINE_DAY   integer 1-31 | "last"     default: "last"
 *
 * WINDOW SEMANTICS
 * ─────────────────
 * The achievement submission window is bounded on BOTH sides:
 *   • OPENS  on MONTHLY_ACHIEVEMENT_START_DAY
 *   • CLOSES on MONTHLY_ACHIEVEMENT_DEADLINE_DAY ("last" = last calendar
 *     day of the month, resolved dynamically per-month on the frontend)
 *
 * Previously only a closing day existed, with no way to configure when the
 * window opens — employees could submit an achievement from day 1 of the
 * month, before their plan for that month was even finalised. If
 * MONTHLY_ACHIEVEMENT_START_DAY is not set, it defaults to the day right
 * after the plan deadline, so the achievement window only opens once the
 * plan window has closed.
 *
 * "last" for achievement means the last calendar day of the month, which is
 * computed dynamically per-month on the frontend.
 */

/* ── Internal helper – also exported so dateMiddleware can reuse it ── */
function parseDeadlineConfig() {
  const rawPlan = process.env.MONTHLY_PLAN_DEADLINE_DAY;
  const rawStart = process.env.MONTHLY_ACHIEVEMENT_START_DAY;
  const rawAch = process.env.MONTHLY_ACHIEVEMENT_DEADLINE_DAY;

  // ── Plan day — must be an integer between 1 and 31 ───────────────────────
  const planDay = rawPlan ? parseInt(rawPlan, 10) : 10;
  if (isNaN(planDay) || planDay < 1 || planDay > 31) {
    console.warn(
      `[DeadlineConfig] Invalid MONTHLY_PLAN_DEADLINE_DAY="${rawPlan}". Falling back to 10.`
    );
  }
  const safePlanDay = isNaN(planDay) || planDay < 1 || planDay > 31 ? 10 : planDay;

  // ── Achievement deadline (closing day) — integer OR sentinel "last" ──────
  let safeAchDay;
  if (!rawAch || rawAch.trim().toLowerCase() === 'last') {
    safeAchDay = 'last';
  } else {
    const achDay = parseInt(rawAch, 10);
    if (isNaN(achDay) || achDay < 1 || achDay > 31) {
      console.warn(
        `[DeadlineConfig] Invalid MONTHLY_ACHIEVEMENT_DEADLINE_DAY="${rawAch}". Falling back to "last".`
      );
      safeAchDay = 'last';
    } else {
      safeAchDay = achDay;
    }
  }

  // ── Achievement start (opening day) ──────────────────────────────────────
  // Default: the day right after the plan deadline, capped at 31, so the
  // achievement window always opens once the plan window has closed —
  // even if ops only customises MONTHLY_PLAN_DEADLINE_DAY and forgets to
  // set this one explicitly.
  const defaultStartDay = Math.min(safePlanDay + 1, 31);

  let safeStartDay;
  if (!rawStart) {
    safeStartDay = defaultStartDay;
  } else {
    const startDay = parseInt(rawStart, 10);
    if (isNaN(startDay) || startDay < 1 || startDay > 31) {
      console.warn(
        `[DeadlineConfig] Invalid MONTHLY_ACHIEVEMENT_START_DAY="${rawStart}". Falling back to ${defaultStartDay}.`
      );
      safeStartDay = defaultStartDay;
    } else {
      safeStartDay = startDay;
    }
  }

  // ── Cross-validation: the window must never be inverted ──────────────────
  // Only meaningful when the deadline is a concrete day — "last" is always
  // on/after any start day between 1 and 31, so it can't be inverted.
  if (safeAchDay !== 'last' && safeStartDay > safeAchDay) {
    console.warn(
      `[DeadlineConfig] MONTHLY_ACHIEVEMENT_START_DAY (${safeStartDay}) is after ` +
      `MONTHLY_ACHIEVEMENT_DEADLINE_DAY (${safeAchDay}) — that would close the ` +
      `achievement window entirely. Falling back to start day 1.`
    );
    safeStartDay = 1;
  }

  return {
    planDay: safePlanDay,
    achievementStartDay: safeStartDay,
    achievementDay: safeAchDay,
  };
}

/**
 * GET /api/config/deadlines
 * Public-ish endpoint (requires valid JWT but no specific role).
 * Returns the current deadline configuration.
 *
 * Response: { planDay: 10, achievementStartDay: 11, achievementDay: "last" }
 *   achievementDay: number | "last"
 */
exports.getDeadlines = (req, res) => {
  try {
    const config = parseDeadlineConfig();
    return res.json(config);
  } catch (err) {
    console.error('[configController] getDeadlines error:', err);
    return res.status(500).json({ message: 'Could not load deadline configuration.' });
  }
};

// Export the parser so dateMiddleware can call it without going through HTTP
exports.parseDeadlineConfig = parseDeadlineConfig;