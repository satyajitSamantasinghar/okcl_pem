/**
 * configController.js
 *
 * Exposes the monthly submission deadline configuration that is stored in
 * environment variables. This is the SINGLE source of truth consumed by
 * both the date-enforcement middleware (dateMiddleware.js) and the React
 * deadline context on the frontend (useDeadlines()).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ROLE-BASED DEADLINES
 * ─────────────────────────────────────────────────────────────────────────
 * An RA's own monthly plan/achievement submission (RA acting in
 * "Employee Mode", i.e. asEmployee=true / selfView=true) is a real
 * obligation with its own SLA — it does not have to mirror a regular
 * employee's deadline. The deadline that applies is always the deadline
 * for the PERSON'S OWN role (req.user.role), never the dashboard/view
 * they happen to be looking at.
 *
 * Every deadline below is therefore resolved per role: "EMPLOYEE" or "RA".
 * Any other role (HRD, MD, ...) safely falls back to the EMPLOYEE config —
 * documented per call site — until/unless a dedicated *_MD or *_HRD set of
 * vars is introduced.
 *
 * ENV VARS (set in backend/.env) — role-suffixed, RA and EMPLOYEE both
 * independently configurable:
 *
 *   MONTHLY_PLAN_DEADLINE_DAY_EMPLOYEE          1-31             default: 10
 *   MONTHLY_PLAN_DEADLINE_DAY_RA                1-31             default: 12
 *
 *   MONTHLY_ACHIEVEMENT_START_DAY_EMPLOYEE      1-31             default: planDay(EMPLOYEE) + 1
 *   MONTHLY_ACHIEVEMENT_START_MONTH_OFFSET_EMPLOYEE   0-2        default: 0  (same month)
 *   MONTHLY_ACHIEVEMENT_DEADLINE_DAY_EMPLOYEE   1-31 | "last"    default: "last"
 *   MONTHLY_ACHIEVEMENT_DEADLINE_MONTH_OFFSET_EMPLOYEE 0-2       default: 0  (same month)
 *
 *   MONTHLY_ACHIEVEMENT_START_DAY_RA            1-31             default: planDay(RA) + 1
 *   MONTHLY_ACHIEVEMENT_START_MONTH_OFFSET_RA   0-2              default: 0  (same month)
 *   MONTHLY_ACHIEVEMENT_DEADLINE_DAY_RA         1-31 | "last"    default: 3
 *   MONTHLY_ACHIEVEMENT_DEADLINE_MONTH_OFFSET_RA 0-2             default: 1  (following month)
 *
 * LEGACY FALLBACK (pre-role-split installs — EMPLOYEE only):
 * If a role-suffixed EMPLOYEE var is not set, the original unsuffixed var
 * is honoured so existing .env files keep working untouched after this
 * upgrade:
 *   MONTHLY_PLAN_DEADLINE_DAY, MONTHLY_ACHIEVEMENT_START_DAY,
 *   MONTHLY_ACHIEVEMENT_DEADLINE_DAY
 * RA has no legacy var to fall back to (it didn't exist before), so it
 * always resolves to its own explicit default when unset.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WINDOW SEMANTICS (per role)
 * ─────────────────────────────────────────────────────────────────────────
 * The achievement submission window is bounded on BOTH sides and is
 * MONTH-FLEXIBLE — it does not have to close within the same calendar
 * month the plan/achievement is FOR:
 *   • OPENS  on achievementStartDay, in the plan's month + achievementStartMonthOffset
 *   • CLOSES on achievementDay ("last" = last calendar day of that month),
 *     in the plan's month + achievementDeadlineMonthOffset
 *
 * Example — RA achievement for July, with DEADLINE_DAY_RA=3 and
 * DEADLINE_MONTH_OFFSET_RA=1: the window for the July record closes on
 * 3 August. Set the offset to 0 to keep it within the same month instead
 * (matching the employee default).
 *
 * A month offset of 0 means "same month as the record", 1 means
 * "the following month", 2 means "two months later" — capped at
 * MAX_MONTH_OFFSET to keep the config sane.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EXTENSION CEILING VARS (used by getExtensionCeiling, enforced server-side)
 * ─────────────────────────────────────────────────────────────────────────
 * These control the latest calendar date an RA may move a deadline to.
 * PLAN extensions always stay within the record's own month (not configurable).
 * ACHIEVEMENT extensions can roll into a later month, bounded by these offsets:
 *
 *   MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_EMPLOYEE  0-2  default: 1
 *   MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_RA        0-2  default: 1
 *
 * Example: offset=1 means an RA can extend the July achievement deadline
 * up to 31 August (last day of planMonth + 1). Set to 0 to force extensions
 * to stay within the same calendar month as the record.
 */

const { addCalendarMonths, buildDeadlineDate } = require("../utils/dateHelpers");

const VALID_ROLES = ["EMPLOYEE", "RA"];
const MAX_MONTH_OFFSET = 2;

/* ════════════════════════════════════════════════════════════════════
   HELPER — normalise an arbitrary role string to "EMPLOYEE" or "RA".
   Any unrecognised/unsupported role (HRD, MD, undefined, ...) safely
   resolves to "EMPLOYEE" so callers never crash on an unexpected role.
════════════════════════════════════════════════════════════════════ */
function normalizeRole(role) {
  const upper = typeof role === "string" ? role.trim().toUpperCase() : "";
  return VALID_ROLES.includes(upper) ? upper : "EMPLOYEE";
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — read an integer env var within [min, max], with a warning
   and safe fallback on anything missing/invalid.
════════════════════════════════════════════════════════════════════ */
function readIntEnv(varName, fallback, { min = 1, max = 31 } = {}) {
  const raw = process.env[varName];
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    console.warn(`[DeadlineConfig] Invalid ${varName}="${raw}". Falling back to ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — read a "day of month OR 'last'" env var.
════════════════════════════════════════════════════════════════════ */
function readDayOrLastEnv(varName, fallback) {
  const raw = process.env[varName];
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  if (raw.trim().toLowerCase() === "last") return "last";

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 31) {
    console.warn(`[DeadlineConfig] Invalid ${varName}="${raw}". Falling back to "${fallback}".`);
    return fallback;
  }
  return parsed;
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — read a month-offset env var (0 = same month, 1 = next
   month, ... capped at MAX_MONTH_OFFSET).
════════════════════════════════════════════════════════════════════ */
function readMonthOffsetEnv(varName, fallback) {
  return readIntEnv(varName, fallback, { min: 0, max: MAX_MONTH_OFFSET });
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — pick which env var NAME to read from: the role-specific one
   if it has a real value, otherwise a legacy unsuffixed var (EMPLOYEE
   only), otherwise just the role-specific name (so the caller's
   fallback default kicks in via readIntEnv/readDayOrLastEnv).
════════════════════════════════════════════════════════════════════ */
function resolveEnvVarName(roleVarName, legacyVarName) {
  const roleVal = process.env[roleVarName];
  if (roleVal !== undefined && roleVal.trim() !== "") return roleVarName;

  if (legacyVarName) {
    const legacyVal = process.env[legacyVarName];
    if (legacyVal !== undefined && legacyVal.trim() !== "") return legacyVarName;
  }

  return roleVarName;
}

/**
 * parseDeadlineConfig(role)
 *
 * role: "EMPLOYEE" | "RA" (anything else normalises to "EMPLOYEE")
 *
 * Returns:
 *   {
 *     role: "EMPLOYEE" | "RA",
 *     planDay: number,
 *     achievementStartDay: number,
 *     achievementStartMonthOffset: number,   // 0 = same month, 1 = next month, ...
 *     achievementDay: number | "last",
 *     achievementDeadlineMonthOffset: number,
 *   }
 */
function parseDeadlineConfig(role = "EMPLOYEE") {
  const normalizedRole = normalizeRole(role);
  const isEmployee = normalizedRole === "EMPLOYEE";

  // ── Plan deadline day ────────────────────────────────────────────────
  const planVar = resolveEnvVarName(
    `MONTHLY_PLAN_DEADLINE_DAY_${normalizedRole}`,
    isEmployee ? "MONTHLY_PLAN_DEADLINE_DAY" : null
  );
  const planDefault = isEmployee ? 10 : 12;
  const planDay = readIntEnv(planVar, planDefault);

  // ── Achievement deadline (closing) day + month offset ───────────────
  const achDayVar = resolveEnvVarName(
    `MONTHLY_ACHIEVEMENT_DEADLINE_DAY_${normalizedRole}`,
    isEmployee ? "MONTHLY_ACHIEVEMENT_DEADLINE_DAY" : null
  );
  const achDayDefault = isEmployee ? "last" : 3;
  const achievementDay = readDayOrLastEnv(achDayVar, achDayDefault);

  const achOffsetDefault = isEmployee ? 0 : 1;
  const achievementDeadlineMonthOffset = readMonthOffsetEnv(
    `MONTHLY_ACHIEVEMENT_DEADLINE_MONTH_OFFSET_${normalizedRole}`,
    achOffsetDefault
  );

  // ── Achievement start (opening) day + month offset ──────────────────
  // Default: the day right after the plan deadline, capped at 31, so the
  // achievement window opens once the plan window closes unless ops
  // customises it explicitly.
  const defaultStartDay = Math.min(planDay + 1, 31);
  const startVar = resolveEnvVarName(
    `MONTHLY_ACHIEVEMENT_START_DAY_${normalizedRole}`,
    isEmployee ? "MONTHLY_ACHIEVEMENT_START_DAY" : null
  );
  let achievementStartDay = readIntEnv(startVar, defaultStartDay);
  let achievementStartMonthOffset = readMonthOffsetEnv(
    `MONTHLY_ACHIEVEMENT_START_MONTH_OFFSET_${normalizedRole}`,
    0
  );

  // ── Cross-validation: the window must never be inverted ─────────────
  // Compare (monthOffset, day) tuples chronologically rather than raw
  // day numbers, since a start of day 25/offset 0 is still BEFORE a
  // deadline of day 3/offset 1 (next month).
  const invertedAgainstConcreteDeadline =
    achievementDay !== "last" &&
    (achievementStartMonthOffset > achievementDeadlineMonthOffset ||
      (achievementStartMonthOffset === achievementDeadlineMonthOffset &&
        achievementStartDay > achievementDay));

  const invertedAgainstLastDayDeadline =
    achievementDay === "last" && achievementStartMonthOffset > achievementDeadlineMonthOffset;

  if (invertedAgainstConcreteDeadline || invertedAgainstLastDayDeadline) {
    console.warn(
      `[DeadlineConfig] (${normalizedRole}) achievement start (offset ${achievementStartMonthOffset}, ` +
      `day ${achievementStartDay}) is after the achievement deadline (offset ${achievementDeadlineMonthOffset}, ` +
      `day ${achievementDay}) — that would close the achievement window entirely. ` +
      `Falling back to start day 1, offset 0.`
    );
    achievementStartDay = 1;
    achievementStartMonthOffset = 0;
  }

  return {
    role: normalizedRole,
    planDay,
    achievementStartDay,
    achievementStartMonthOffset,
    achievementDay,
    achievementDeadlineMonthOffset,
  };
}

/**
 * getAllDeadlineConfigs()
 * Convenience helper returning both role configs at once — used by the
 * API response so a UI can show "your deadline" alongside the other
 * role's, without a second round trip.
 */
function getAllDeadlineConfigs() {
  return {
    EMPLOYEE: parseDeadlineConfig("EMPLOYEE"),
    RA: parseDeadlineConfig("RA"),
  };
}

/**
 * GET /api/config/deadlines[?role=EMPLOYEE|RA]
 * Requires a valid JWT (any role).
 *
 * Resolves the deadline config for the CALLER'S OWN role (req.user.role)
 * by default — this is what actually governs their submissions,
 * regardless of which dashboard/view they are currently looking at (an
 * RA in "Employee Mode" is still held to the RA deadlines, since the
 * obligation follows the person, not the screen).
 *
 * An optional ?role= query override is accepted for read-only preview
 * purposes only (e.g. an HRD/MD screen displaying both configs side by
 * side). It has NO bearing on enforcement — allowMonthlyPlanSubmission
 * and allowMonthlyAchievementSubmission in dateMiddleware.js always
 * resolve strictly from req.user.role, never from a query param.
 *
 * Response (backward-compatible flat shape, resolved for the caller's
 * role, PLUS a full per-role breakdown under `byRole`):
 *   {
 *     role: "RA",
 *     planDay: 12,
 *     achievementStartDay: 13,
 *     achievementStartMonthOffset: 0,
 *     achievementDay: 3,
 *     achievementDeadlineMonthOffset: 1,
 *     byRole: { EMPLOYEE: {...}, RA: {...} }
 *   }
 */
exports.getDeadlines = (req, res) => {
  try {
    const requestedRole = req.query.role;
    const effectiveRole = requestedRole ? normalizeRole(requestedRole) : normalizeRole(req.user && req.user.role);
    const config = parseDeadlineConfig(effectiveRole);

    return res.json({
      ...config,
      byRole: getAllDeadlineConfigs(),
    });
  } catch (err) {
    console.error("[configController] getDeadlines error:", err);
    return res.status(500).json({ message: "Could not load deadline configuration." });
  }
};

/**
 * getExtensionCeiling(role, type, planMonth, planYear)
 *
 * Returns the latest calendar Date (end-of-day) an RA is allowed to move
 * this deadline to, for the given record's own month/year.
 *
 * PLAN        → always the last day of the record's own month (planMonth/planYear).
 *               Plan extensions never cross into a new month.
 *
 * ACHIEVEMENT → the last day of (planMonth + N), where N is read from
 *               MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_EMPLOYEE /
 *               MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_RA (default: 1).
 *               Uses addCalendarMonths + buildDeadlineDate from utils/dateHelpers.js.
 *
 * @param {string} role       "EMPLOYEE" | "RA" (normalised internally)
 * @param {string} type       "PLAN" | "ACHIEVEMENT"
 * @param {number} planMonth  1-12
 * @param {number} planYear   full year (e.g. 2026)
 * @returns {Date}  end-of-day ceiling date
 */
function getExtensionCeiling(role, type, planMonth, planYear) {
  const normalizedRole = normalizeRole(role);
  const isEmployee = normalizedRole === "EMPLOYEE";
  const typeUpper = typeof type === "string" ? type.toUpperCase() : "PLAN";

  if (typeUpper === "PLAN") {
    // Plan extensions are capped at the last day of the record's own month.
    return buildDeadlineDate(planYear, planMonth, "last", 0, true);
  }

  // ACHIEVEMENT — read the max month offset from env, default 1.
  const varName = isEmployee
    ? "MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_EMPLOYEE"
    : "MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_RA";
  const offset = readMonthOffsetEnv(varName, 1);

  // Last day of (planMonth + offset).
  return buildDeadlineDate(planYear, planMonth, "last", offset, true);
}

// Exported so dateMiddleware can call these directly without going through HTTP
exports.parseDeadlineConfig = parseDeadlineConfig;
exports.getAllDeadlineConfigs = getAllDeadlineConfigs;
exports.normalizeRole = normalizeRole;
exports.getExtensionCeiling = getExtensionCeiling;