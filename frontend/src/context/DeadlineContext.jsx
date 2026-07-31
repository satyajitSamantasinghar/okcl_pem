/**
 * DeadlineContext.jsx
 *
 * Centralized, dynamic, role-aware monthly deadline configuration for the
 * entire frontend. This is the SINGLE source of truth consumed by all pages
 * and components — no page ever hardcodes a day number.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────
 * Fetches GET /api/config/deadlines once when the authenticated user session
 * starts (inside DeadlineProvider). The backend resolves deadlines PER ROLE
 * (EMPLOYEE vs RA) from environment variables, and returns BOTH role configs
 * under `byRole` alongside the caller's own resolved config (flat fields).
 *
 * All pages consume deadlines via the useDeadlines() hook, which exposes:
 *   • Role-specific deadline configs for the currently signed-in user's role
 *   • A `forRole(role)` accessor to query any role's config (e.g. for HRD/MD
 *     screens that display both EMPLOYEE and RA deadlines side-by-side)
 *   • Full month-offset-aware date utilities — so a July achievement for an RA
 *     with achievementDeadlineMonthOffset=1 correctly resolves to 3 August,
 *     not 3 July.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ROLE-BASED DEADLINE SEMANTICS (mirrors backend configController.js)
 * ─────────────────────────────────────────────────────────────────────────
 * The deadline that governs a user's OWN plan/achievement submission is
 * always their OWN role's config (req.user.role on the backend). An RA
 * looking at their Employee Mode view is still bound to RA deadlines, not
 * the employee deadlines. The `byRole` map lets the UI display the correct
 * deadline to each user without a second round-trip.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WINDOW SEMANTICS
 * ─────────────────────────────────────────────────────────────────────────
 * The achievement submission window is bounded on BOTH sides and is
 * MONTH-FLEXIBLE — it is anchored to the linked plan's own month ("YYYY-MM"),
 * NOT to the current calendar month:
 *   • OPENS  on achievementStartDay of (planMonth + achievementStartMonthOffset)
 *   • CLOSES on achievementDay       of (planMonth + achievementDeadlineMonthOffset)
 *     where achievementDay === "last" resolves to that target month's last day.
 *
 * Example — RA achievement for July, DEADLINE_DAY_RA=3, DEADLINE_MONTH_OFFSET_RA=1:
 *   The window for the July record CLOSES on 3 August, not 3 July.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EXTENSION AWARENESS (new in the Deadline Extension System Overhaul)
 * ─────────────────────────────────────────────────────────────────────────
 * The base deadline functions (getPlanDeadline, getAchievementDeadline) return
 * the RAW config-based deadline. They are NOT extension-aware. Use them for:
 *   - Display labels ("original deadline")
 *   - Extension ceiling calculations
 *   - Situations where you explicitly want the base, e.g. showing "base: Jul 27"
 *
 * For enforcement and submission-gate checks, use the EFFECTIVE deadline helpers
 * (getEffectivePlanDeadline, getEffectiveAchievementDeadline). These call the
 * backend's GET /ra/extend-deadline/context endpoint and return the extended
 * deadline if one exists, otherwise the base deadline. They are async and return
 * Promises — use them inside useEffect/event handlers, not inside render.
 *
 * The boolean helpers (isBeforeEffectivePlanDeadline, etc.) wrap those Promises
 * for convenience gate-checks.
 *
 * Extension ceilings (getExtensionCeiling) mirror the backend's
 * getExtensionCeiling() in configController.js and are used by the date-picker
 * max constraint inside ExtendDeadlineModal without a network round-trip.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GRACEFUL DEGRADATION
 * ─────────────────────────────────────────────────────────────────────────
 * If the API call fails (network error, server down), the context falls back
 * to the ROLE_DEFAULTS map below, which mirrors the backend's own defaults.
 * Each role's defaults are independent so a bad response for one role never
 * corrupts the other.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SOURCE OF TRUTH
 * ─────────────────────────────────────────────────────────────────────────
 * The backend reads its values from .env (see configController.js for the
 * full list of env vars). Changing .env and restarting the server
 * automatically updates every page in the UI on the next load — no frontend
 * code changes needed.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

/* ══════════════════════════════════════════════════════════════════════════
   GO_LIVE — earliest month the system tracks obligations.
   MUST mirror backend dateHelpers.js GO_LIVE = { year: 2026, month: 5 }.
   Any component that builds month range lists (e.g. deadline-management
   month picker) imports this instead of hardcoding "2026-05".
══════════════════════════════════════════════════════════════════════════ */
/** @type {{ year: number, month: number }} */
export const GO_LIVE = { year: 2026, month: 5 }; // May 2026

/* ══════════════════════════════════════════════════════════════════════════
   EXTENSION CEILING DEFAULTS
   Mirrors MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_* env var defaults
   in configController.js. Used by getExtensionCeiling() below.
   If the org changes the env vars, they only need to update them on the
   backend — these frontend defaults are only the fallback for the ceiling
   calculation that the ExtendDeadlineModal uses for its date-picker `max`.
   The backend ALWAYS enforces the true ceiling server-side.
══════════════════════════════════════════════════════════════════════════ */
export const EXTENSION_CEILING_DEFAULTS = {
  /** How many months after the plan month an EMPLOYEE achievement can be extended to. */
  EMPLOYEE: 1,
  /** How many months after the plan month an RA achievement can be extended to. */
  RA: 1,
};

/* ══════════════════════════════════════════════════════════════════════════
   CANONICAL DEFAULTS — mirrors backend configController.js defaults exactly.
   Used when the API is unavailable or a role is not recognised.
   Any change to backend defaults MUST be reflected here.
══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {{
 *   planDay: number,
 *   achievementStartDay: number,
 *   achievementStartMonthOffset: number,
 *   achievementDay: number|'last',
 *   achievementDeadlineMonthOffset: number
 * }} RoleDeadlineConfig
 */

/** @type {Record<'EMPLOYEE'|'RA', RoleDeadlineConfig>} */
export const ROLE_DEFAULTS = {
  EMPLOYEE: {
    planDay: 10,
    achievementStartDay: 11,           // planDay + 1
    achievementStartMonthOffset: 0,    // same month as the plan record
    achievementDay: 'last',            // last calendar day of the record's month
    achievementDeadlineMonthOffset: 0, // same month as the plan record
  },
  RA: {
    planDay: 12,
    achievementStartDay: 13,           // planDay + 1
    achievementStartMonthOffset: 0,    // same month as the plan record
    achievementDay: 3,                 // 3rd of the following month
    achievementDeadlineMonthOffset: 1, // following month
  },
};

/**
 * Kept for backward-compatibility with any consumer that imports DEADLINE_DEFAULTS.
 * Points to the EMPLOYEE role defaults (the original pre-role-split default).
 */
export const DEADLINE_DEFAULTS = {
  planDay: ROLE_DEFAULTS.EMPLOYEE.planDay,
  achievementStartDay: ROLE_DEFAULTS.EMPLOYEE.achievementStartDay,
  achievementDay: ROLE_DEFAULTS.EMPLOYEE.achievementDay,
};

/* ══════════════════════════════════════════════════════════════════════════
   PURE UTILITY FUNCTIONS
   Module-level so they can be tested independently of the React tree.
══════════════════════════════════════════════════════════════════════════ */

/**
 * Normalize any role string to "EMPLOYEE" or "RA" (mirrors backend
 * normalizeRole). Falls back to "EMPLOYEE" for HRD, MD, unknown roles, etc.
 * @param {string|undefined} role
 * @returns {'EMPLOYEE'|'RA'}
 */
function normalizeRole(role) {
  const upper = typeof role === 'string' ? role.trim().toUpperCase() : '';
  return upper === 'RA' ? 'RA' : 'EMPLOYEE';
}

/**
 * Returns the last calendar day of a given (year, 1-based month).
 * @param {number} year
 * @param {number} month  1-based (1 = January … 12 = December)
 * @returns {number}
 */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Add `offset` calendar months to a (year, 1-based month) pair, normalising
 * month overflow into the year.
 * e.g. addCalendarMonths(2026, 12, 1) → { year: 2027, month: 1 }
 * @param {number} year
 * @param {number} month   1-based
 * @param {number} offset  non-negative integer
 * @returns {{ year: number, month: number }}
 */
function addCalendarMonths(year, month, offset) {
  const zeroBasedTotal = (month - 1) + offset;
  return {
    year:  year + Math.floor(zeroBasedTotal / 12),
    month: (zeroBasedTotal % 12) + 1,
  };
}

/**
 * Build a concrete Date for a given (planYear, planMonth, day, monthOffset).
 *
 * This is the core date-building primitive. It mirrors the backend's
 * buildDeadlineDate() in utils/dateHelpers.js so both sides compute identical
 * dates for the same config values.
 *
 * @param {number}           planYear     Calendar year of the PLAN record.
 * @param {number}           planMonth    1-based calendar month of the PLAN record.
 * @param {number|'last'}    day          Target day, or "last" = last day of target month.
 * @param {number}           monthOffset  How many calendar months to add to (planYear, planMonth).
 * @param {boolean}          endOfDay     true → 23:59:59.999 ; false → 00:00:00.000
 * @returns {Date}
 */
function buildDeadlineDate(planYear, planMonth, day, monthOffset, endOfDay) {
  const { year: targetYear, month: targetMonth } = addCalendarMonths(planYear, planMonth, monthOffset);
  const last        = lastDayOfMonth(targetYear, targetMonth);
  const resolvedDay = day === 'last' ? last : Math.min(day, last);

  return endOfDay
    ? new Date(targetYear, targetMonth - 1, resolvedDay, 23, 59, 59, 999)
    : new Date(targetYear, targetMonth - 1, resolvedDay, 0, 0, 0, 0);
}

/**
 * Parse a "YYYY-MM" string into { year, month }.
 * Returns null on malformed input so callers can bail early.
 * @param {string} monthStr
 * @returns {{ year: number, month: number }|null}
 */
function parseMonthStr(monthStr) {
  if (!monthStr || typeof monthStr !== 'string') return null;
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

/**
 * Validate and sanitize a single RoleDeadlineConfig object from the API.
 * Any invalid/missing field is replaced with the corresponding fallback value.
 *
 * @param {unknown}            raw      The raw object from the API response.
 * @param {RoleDeadlineConfig} fallback Canonical defaults for this role.
 * @returns {RoleDeadlineConfig}
 */
function sanitizeRoleConfig(raw, fallback) {
  if (!raw || typeof raw !== 'object') return { ...fallback };

  const planDay =
    typeof raw.planDay === 'number' && raw.planDay >= 1 && raw.planDay <= 31
      ? raw.planDay
      : fallback.planDay;

  const achievementStartDay =
    typeof raw.achievementStartDay === 'number' &&
    raw.achievementStartDay >= 1 &&
    raw.achievementStartDay <= 31
      ? raw.achievementStartDay
      : fallback.achievementStartDay;

  const achievementStartMonthOffset =
    typeof raw.achievementStartMonthOffset === 'number' &&
    raw.achievementStartMonthOffset >= 0 &&
    raw.achievementStartMonthOffset <= 2
      ? raw.achievementStartMonthOffset
      : fallback.achievementStartMonthOffset;

  const achievementDay =
    raw.achievementDay === 'last' ||
    (typeof raw.achievementDay === 'number' &&
      raw.achievementDay >= 1 &&
      raw.achievementDay <= 31)
      ? raw.achievementDay
      : fallback.achievementDay;

  const achievementDeadlineMonthOffset =
    typeof raw.achievementDeadlineMonthOffset === 'number' &&
    raw.achievementDeadlineMonthOffset >= 0 &&
    raw.achievementDeadlineMonthOffset <= 2
      ? raw.achievementDeadlineMonthOffset
      : fallback.achievementDeadlineMonthOffset;

  return {
    planDay,
    achievementStartDay,
    achievementStartMonthOffset,
    achievementDay,
    achievementDeadlineMonthOffset,
  };
}

/**
 * Parse the effective deadline string ("YYYY-MM-DD") returned by the context
 * API into a Date (end-of-day) so it can be compared with `new Date()`.
 * Returns null if the string is missing or malformed.
 *
 * @param {string|undefined} dateStr  e.g. "2026-07-31"
 * @returns {Date|null}
 */
function parseDateOnlyEndOfDay(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/* ══════════════════════════════════════════════════════════════════════════
   CONTEXT SHAPE
   Full default shape documented here for IDE auto-complete.
══════════════════════════════════════════════════════════════════════════ */
const DeadlineContext = createContext({
  /** Whether the initial API fetch is still in-flight. */
  isLoading: true,

  // ── Flat fields for the caller's own role (backward-compatible) ──────────
  planDay:                      ROLE_DEFAULTS.EMPLOYEE.planDay,
  achievementStartDay:          ROLE_DEFAULTS.EMPLOYEE.achievementStartDay,
  achievementStartMonthOffset:  ROLE_DEFAULTS.EMPLOYEE.achievementStartMonthOffset,
  achievementDay:               ROLE_DEFAULTS.EMPLOYEE.achievementDay,
  achievementDeadlineMonthOffset: ROLE_DEFAULTS.EMPLOYEE.achievementDeadlineMonthOffset,

  // ── Full per-role breakdown ───────────────────────────────────────────────
  /** { EMPLOYEE: RoleDeadlineConfig, RA: RoleDeadlineConfig } */
  byRole: ROLE_DEFAULTS,

  // ── Role accessor ─────────────────────────────────────────────────────────
  /** Returns the RoleDeadlineConfig for an arbitrary role string. */
  forRole: (_role) => ROLE_DEFAULTS.EMPLOYEE,

  // ── Own-role date builders (BASE deadlines — not extension-aware) ─────────
  getPlanDeadline:          (_monthStr) => null,
  getAchievementWindowStart: (_monthStr) => null,
  getAchievementDeadline:   (_monthStr) => null,

  // ── Explicit-role date builders (BASE deadlines) ──────────────────────────
  getPlanDeadlineForRole:           (_monthStr, _role) => null,
  getAchievementWindowStartForRole: (_monthStr, _role) => null,
  getAchievementDeadlineForRole:    (_monthStr, _role) => null,

  // ── Extension ceiling (date-picker max, no API call needed) ──────────────
  /**
   * Returns the latest Date an RA can set as a new deadline — mirrors the
   * backend's getExtensionCeiling(). Used by ExtendDeadlineModal date-picker
   * max. The server ALWAYS re-validates on submission regardless.
   */
  getExtensionCeiling: (_type, _role, _monthStr) => null,

  // ── Effective deadline helpers (extension-aware, async) ──────────────────
  /**
   * Fetches the EFFECTIVE plan deadline for a given employee + month from
   * GET /ra/extend-deadline/context. Returns a Promise<{ effectiveDeadline,
   * isExtended, extensionCount, baseDeadline, maxDate }>.
   * Falls back to the base deadline if the fetch fails.
   */
  getEffectivePlanDeadline: (_employeeId, _monthStr) => Promise.resolve(null),

  /**
   * Same as getEffectivePlanDeadline but for the achievement deadline.
   */
  getEffectiveAchievementDeadline: (_employeeId, _monthStr) => Promise.resolve(null),

  // ── Boolean helpers (own role, BASE deadline) ─────────────────────────────
  isBeforePlanDeadline:       (_monthStr) => true,
  isAfterAchievementStart:    (_monthStr) => true,
  isBeforeAchievementDeadline: (_monthStr) => true,
  isWithinAchievementWindow:  (_monthStr) => true,

  // ── Day resolver (own role, target-month-aware) ───────────────────────────
  resolvedAchievementDay: (_monthStr) => null,
});

/* ══════════════════════════════════════════════════════════════════════════
   PROVIDER
══════════════════════════════════════════════════════════════════════════ */
export function DeadlineProvider({ children }) {
  const { isAuthenticated, user } = useAuth();

  // ── State ────────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);

  /**
   * byRole holds the validated per-role breakdown returned by the API.
   * Pre-seeded with ROLE_DEFAULTS so every helper is safe to call before
   * the first API response arrives.
   */
  const [byRole, setByRole] = useState({ ...ROLE_DEFAULTS });

  // ── Fetch once on authentication ─────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    api
      .get('/config/deadlines')
      .then(({ data }) => {
        if (cancelled) return;

        // The backend always returns `byRole: { EMPLOYEE: {...}, RA: {...} }`.
        // Validate each role independently so a bad field in one role never
        // corrupts the other.
        const rawByRole = data?.byRole ?? {};

        setByRole({
          EMPLOYEE: sanitizeRoleConfig(rawByRole.EMPLOYEE, ROLE_DEFAULTS.EMPLOYEE),
          RA:       sanitizeRoleConfig(rawByRole.RA,       ROLE_DEFAULTS.RA),
        });
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(
          '[DeadlineContext] Could not fetch deadline config — using role defaults.',
          err?.message,
        );
        // byRole stays seeded with ROLE_DEFAULTS (set in useState initializer)
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // ── Derive the caller's own role config ──────────────────────────────────
  // Re-derived whenever byRole or the logged-in user changes. No extra state
  // needed — just a memoised selector to avoid unnecessary re-renders.
  const ownRole   = normalizeRole(user?.role);
  const ownConfig = useMemo(
    () => byRole[ownRole] ?? ROLE_DEFAULTS.EMPLOYEE,
    [byRole, ownRole],
  );

  // ── Role accessor ─────────────────────────────────────────────────────────
  /**
   * Returns the RoleDeadlineConfig for any arbitrary role string.
   * Falls back to EMPLOYEE config for unrecognised roles (HRD, MD, …).
   * Stable reference via useCallback so consumers can include it in dep arrays.
   */
  const forRole = useCallback(
    (role) => {
      const normalised = normalizeRole(role);
      return byRole[normalised] ?? ROLE_DEFAULTS.EMPLOYEE;
    },
    [byRole],
  );

  /* ── Explicit-role date builders ─────────────────────────────────────────
     These are the canonical implementations. All "own-role" helpers below
     delegate here — keeps the logic DRY and guarantees a single code path.
  ──────────────────────────────────────────────────────────────────────── */

  /**
   * Returns a Date set to end-of-day on the plan deadline for the given
   * YYYY-MM plan month, resolved against an explicit role's config.
   * Pass role=null/undefined to use the caller's own role.
   *
   * NOTE: This is the BASE (config-based) deadline. It does NOT account for
   * extensions. For extension-aware behaviour, use getEffectivePlanDeadline().
   */
  const getPlanDeadlineForRole = useCallback(
    (monthStr, role) => {
      const parsed = parseMonthStr(monthStr);
      if (!parsed) return null;
      const cfg = role ? forRole(role) : ownConfig;
      // Plan deadline is always within the plan's own month (offset = 0)
      return buildDeadlineDate(parsed.year, parsed.month, cfg.planDay, 0, true);
    },
    [forRole, ownConfig],
  );

  /**
   * Returns a Date set to start-of-day on the achievement window's OPENING
   * for the given YYYY-MM plan record, respecting achievementStartMonthOffset.
   */
  const getAchievementWindowStartForRole = useCallback(
    (monthStr, role) => {
      const parsed = parseMonthStr(monthStr);
      if (!parsed) return null;
      const cfg = role ? forRole(role) : ownConfig;
      return buildDeadlineDate(
        parsed.year,
        parsed.month,
        cfg.achievementStartDay,
        cfg.achievementStartMonthOffset,
        false,
      );
    },
    [forRole, ownConfig],
  );

  /**
   * Returns a Date set to end-of-day on the achievement window's CLOSING
   * for the given YYYY-MM plan record, respecting achievementDeadlineMonthOffset.
   *
   * This is the critical fix: an RA's July record with offset=1 correctly
   * resolves to 3 August, NOT 3 July.
   *
   * NOTE: This is the BASE (config-based) deadline. It does NOT account for
   * extensions. For extension-aware behaviour, use getEffectiveAchievementDeadline().
   */
  const getAchievementDeadlineForRole = useCallback(
    (monthStr, role) => {
      const parsed = parseMonthStr(monthStr);
      if (!parsed) return null;
      const cfg = role ? forRole(role) : ownConfig;
      return buildDeadlineDate(
        parsed.year,
        parsed.month,
        cfg.achievementDay,
        cfg.achievementDeadlineMonthOffset,
        true,
      );
    },
    [forRole, ownConfig],
  );

  /* ── Own-role shorthand date builders (backward-compatible API) ── */

  /** Plan deadline Date for the caller's own role (BASE — not extension-aware). */
  const getPlanDeadline = useCallback(
    (monthStr) => getPlanDeadlineForRole(monthStr, null),
    [getPlanDeadlineForRole],
  );

  /** Achievement window start Date for the caller's own role. */
  const getAchievementWindowStart = useCallback(
    (monthStr) => getAchievementWindowStartForRole(monthStr, null),
    [getAchievementWindowStartForRole],
  );

  /** Achievement deadline Date for the caller's own role (BASE — not extension-aware). */
  const getAchievementDeadline = useCallback(
    (monthStr) => getAchievementDeadlineForRole(monthStr, null),
    [getAchievementDeadlineForRole],
  );

  /* ── Extension Ceiling ────────────────────────────────────────────────────
     Mirrors backend configController.getExtensionCeiling().
     Used by ExtendDeadlineModal to set the date-picker `max` attribute
     WITHOUT a network round-trip (the backend always re-validates on submit).

     Rules:
       PLAN        → last day of the plan record's own month (never crosses months)
       ACHIEVEMENT → last day of (planMonth + offset), offset from
                     EXTENSION_CEILING_DEFAULTS[role] (default: 1)

     @param {'PLAN'|'ACHIEVEMENT'} type
     @param {string}               role      any role string (normalised internally)
     @param {string}               monthStr  "YYYY-MM" of the plan record
     @returns {Date|null}  end-of-day ceiling date, or null on bad input
  ──────────────────────────────────────────────────────────────────────── */
  const getExtensionCeiling = useCallback(
    (type, role, monthStr) => {
      const parsed = parseMonthStr(monthStr);
      if (!parsed) return null;

      const typeUpper = typeof type === 'string' ? type.toUpperCase() : 'PLAN';

      if (typeUpper === 'PLAN') {
        // Plan extensions are capped at the last day of the record's own month.
        return buildDeadlineDate(parsed.year, parsed.month, 'last', 0, true);
      }

      // ACHIEVEMENT — use the offset from EXTENSION_CEILING_DEFAULTS.
      const normRole = normalizeRole(role);
      const offset   = EXTENSION_CEILING_DEFAULTS[normRole] ?? 1;
      return buildDeadlineDate(parsed.year, parsed.month, 'last', offset, true);
    },
    [],
  );

  /* ── Effective deadline helpers (extension-aware, async) ─────────────────
     These call GET /ra/extend-deadline/context which is an RA/MD-only endpoint.
     For employee-facing pages (where the caller IS the subject), pass the
     logged-in user's own ID. For RA management pages, pass the target
     employee's ID.

     Both return a Promise that resolves to an object:
     {
       effectiveDeadline: Date,   ← the date to use for enforcement/display
       isExtended: boolean,       ← true if a DB extension exists
       extensionCount: number,    ← how many times it has been extended
       baseDeadline: Date,        ← the raw config deadline (for "original" labels)
       maxDate: string,           ← "YYYY-MM-DD" ceiling for the date-picker
     }

     On any fetch error the helpers fall back to the base deadline so pages
     degrade gracefully — they never throw or return null.
  ──────────────────────────────────────────────────────────────────────── */

  /**
   * Returns a Promise resolving to the effective PLAN deadline for the given
   * employee and plan month.
   *
   * @param {string} employeeId  UUID of the plan owner
   * @param {string} monthStr    "YYYY-MM"
   * @param {string} [empRole]   role of the employee (used for fallback only)
   * @returns {Promise<{
   *   effectiveDeadline: Date,
   *   isExtended: boolean,
   *   extensionCount: number,
   *   baseDeadline: Date,
   *   maxDate: string,
   * }>}
   */
  const getEffectivePlanDeadline = useCallback(
    async (employeeId, monthStr, empRole) => {
      const parsed = parseMonthStr(monthStr);
      const baseCfg = forRole(empRole || ownRole);
      const basePlanDeadline = parsed
        ? buildDeadlineDate(parsed.year, parsed.month, baseCfg.planDay, 0, true)
        : null;

      const fallback = {
        effectiveDeadline: basePlanDeadline,
        isExtended: false,
        extensionCount: 0,
        baseDeadline: basePlanDeadline,
        maxDate: parsed
          ? buildDeadlineDate(parsed.year, parsed.month, 'last', 0, true)
              .toISOString().split('T')[0]
          : null,
      };

      if (!employeeId || !parsed) return fallback;

      try {
        const res = await api.get('/ra/extend-deadline/context', {
          params: {
            employeeId,
            month: parsed.month,
            year:  parsed.year,
            type:  'PLAN',
          },
        });
        const d = res.data;
        return {
          effectiveDeadline: parseDateOnlyEndOfDay(d.effectiveDeadline) ?? basePlanDeadline,
          isExtended:        !!d.isExtended,
          extensionCount:    d.extensionCount ?? 0,
          baseDeadline:      parseDateOnlyEndOfDay(d.baseDeadline) ?? basePlanDeadline,
          maxDate:           d.maxDate ?? fallback.maxDate,
        };
      } catch {
        // Non-RA callers (e.g. employee pages) will get a 403 — that is expected.
        // Fall back silently to the base deadline.
        return fallback;
      }
    },
    [forRole, ownRole],
  );

  /**
   * Returns a Promise resolving to the effective ACHIEVEMENT deadline for the
   * given employee and plan month.
   *
   * @param {string} employeeId  UUID of the plan owner
   * @param {string} monthStr    "YYYY-MM"
   * @param {string} [empRole]   role of the employee (used for fallback only)
   * @returns {Promise<{
   *   effectiveDeadline: Date,
   *   isExtended: boolean,
   *   extensionCount: number,
   *   baseDeadline: Date,
   *   maxDate: string,
   * }>}
   */
  const getEffectiveAchievementDeadline = useCallback(
    async (employeeId, monthStr, empRole) => {
      const parsed = parseMonthStr(monthStr);
      const baseCfg = forRole(empRole || ownRole);
      const baseAchDeadline = parsed
        ? buildDeadlineDate(
            parsed.year,
            parsed.month,
            baseCfg.achievementDay,
            baseCfg.achievementDeadlineMonthOffset,
            true,
          )
        : null;

      const normRole = normalizeRole(empRole || ownRole);
      const ceilingOffset = EXTENSION_CEILING_DEFAULTS[normRole] ?? 1;
      const fallback = {
        effectiveDeadline: baseAchDeadline,
        isExtended: false,
        extensionCount: 0,
        baseDeadline: baseAchDeadline,
        maxDate: parsed
          ? buildDeadlineDate(parsed.year, parsed.month, 'last', ceilingOffset, true)
              .toISOString().split('T')[0]
          : null,
      };

      if (!employeeId || !parsed) return fallback;

      try {
        const res = await api.get('/ra/extend-deadline/context', {
          params: {
            employeeId,
            month: parsed.month,
            year:  parsed.year,
            type:  'ACHIEVEMENT',
          },
        });
        const d = res.data;
        return {
          effectiveDeadline: parseDateOnlyEndOfDay(d.effectiveDeadline) ?? baseAchDeadline,
          isExtended:        !!d.isExtended,
          extensionCount:    d.extensionCount ?? 0,
          baseDeadline:      parseDateOnlyEndOfDay(d.baseDeadline) ?? baseAchDeadline,
          maxDate:           d.maxDate ?? fallback.maxDate,
        };
      } catch {
        return fallback;
      }
    },
    [forRole, ownRole],
  );

  /* ── Boolean helpers (own role, BASE deadline) ─────────────────────────── */

  const isBeforePlanDeadline = useCallback(
    (monthStr) => {
      const deadline = getPlanDeadline(monthStr);
      if (!deadline) return true; // safe fallback: allow when deadline is unknown
      return new Date() <= deadline;
    },
    [getPlanDeadline],
  );

  const isAfterAchievementStart = useCallback(
    (monthStr) => {
      const start = getAchievementWindowStart(monthStr);
      if (!start) return true;
      return new Date() >= start;
    },
    [getAchievementWindowStart],
  );

  const isBeforeAchievementDeadline = useCallback(
    (monthStr) => {
      const deadline = getAchievementDeadline(monthStr);
      if (!deadline) return true;
      return new Date() <= deadline;
    },
    [getAchievementDeadline],
  );

  const isWithinAchievementWindow = useCallback(
    (monthStr) =>
      isAfterAchievementStart(monthStr) && isBeforeAchievementDeadline(monthStr),
    [isAfterAchievementStart, isBeforeAchievementDeadline],
  );

  /* ── resolvedAchievementDay ──────────────────────────────────────────────
     Returns the CONCRETE day number for the achievement deadline for a given
     YYYY-MM plan record (own role config).

     When achievementDay === "last", this correctly resolves to the last day
     of the TARGET month — i.e. (planMonth + achievementDeadlineMonthOffset)
     — NOT the plan's own month, which matters when offset > 0.
  ──────────────────────────────────────────────────────────────────────── */
  const resolvedAchievementDay = useCallback(
    (monthStr) => {
      const parsed = parseMonthStr(monthStr);
      if (!parsed) return null;
      const { year: targetYear, month: targetMonth } = addCalendarMonths(
        parsed.year,
        parsed.month,
        ownConfig.achievementDeadlineMonthOffset,
      );
      return ownConfig.achievementDay === 'last'
        ? lastDayOfMonth(targetYear, targetMonth)
        : ownConfig.achievementDay;
    },
    [ownConfig],
  );

  /* ── Context value ──────────────────────────────────────────────────────── */
  const value = useMemo(
    () => ({
      // Loading flag
      isLoading,

      // Flat convenience fields for the caller's own role (backward-compatible
      // with all existing consumers that destructure these directly)
      planDay:                      ownConfig.planDay,
      achievementStartDay:          ownConfig.achievementStartDay,
      achievementStartMonthOffset:  ownConfig.achievementStartMonthOffset,
      achievementDay:               ownConfig.achievementDay,
      achievementDeadlineMonthOffset: ownConfig.achievementDeadlineMonthOffset,

      // Full per-role breakdown (HRD/MD cross-role display, debugging)
      byRole,

      // Role accessor
      forRole,

      // Own-role date builders (BASE — not extension-aware)
      getPlanDeadline,
      getAchievementWindowStart,
      getAchievementDeadline,

      // Explicit-role date builders (BASE — not extension-aware)
      getPlanDeadlineForRole,
      getAchievementWindowStartForRole,
      getAchievementDeadlineForRole,

      // Extension ceiling (synchronous, no API call, used for date-picker max)
      getExtensionCeiling,

      // Effective deadline helpers (extension-aware, async, RA/MD-accessible)
      getEffectivePlanDeadline,
      getEffectiveAchievementDeadline,

      // Boolean helpers (own role, BASE deadline)
      isBeforePlanDeadline,
      isAfterAchievementStart,
      isBeforeAchievementDeadline,
      isWithinAchievementWindow,

      // Day resolver
      resolvedAchievementDay,
    }),
    [
      isLoading,
      ownConfig,
      byRole,
      forRole,
      getPlanDeadline,
      getAchievementWindowStart,
      getAchievementDeadline,
      getPlanDeadlineForRole,
      getAchievementWindowStartForRole,
      getAchievementDeadlineForRole,
      getExtensionCeiling,
      getEffectivePlanDeadline,
      getEffectiveAchievementDeadline,
      isBeforePlanDeadline,
      isAfterAchievementStart,
      isBeforeAchievementDeadline,
      isWithinAchievementWindow,
      resolvedAchievementDay,
    ],
  );

  return <DeadlineContext.Provider value={value}>{children}</DeadlineContext.Provider>;
}

/* ══════════════════════════════════════════════════════════════════════════
   HOOK
══════════════════════════════════════════════════════════════════════════ */
/**
 * useDeadlines()
 *
 * Returns the full deadline context for the currently signed-in user.
 * Must be used inside a <DeadlineProvider> (itself inside <AuthProvider>).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BASE DEADLINE FIELDS (config-only, synchronous)
 * ─────────────────────────────────────────────────────────────────────────
 *   planDay, achievementStartDay, achievementStartMonthOffset,
 *   achievementDay, achievementDeadlineMonthOffset
 *     → Flat fields for the caller's own role. Backward-compatible with all
 *       pre-role-split consumers.
 *
 *   byRole  →  { EMPLOYEE: RoleDeadlineConfig, RA: RoleDeadlineConfig }
 *     → Full per-role breakdown for cross-role display (HRD/MD dashboards).
 *
 *   forRole(role)
 *     → Returns the RoleDeadlineConfig for an arbitrary role string without
 *       a second network round-trip.
 *
 *   getPlanDeadline(monthStr)
 *   getAchievementWindowStart(monthStr)
 *   getAchievementDeadline(monthStr)
 *     → Month-offset-aware Date objects anchored to the plan record's own
 *       month (YYYY-MM). Use these for the caller's own role.
 *       These are BASE deadlines — they do NOT account for extensions.
 *
 *   getPlanDeadlineForRole(monthStr, role)
 *   getAchievementWindowStartForRole(monthStr, role)
 *   getAchievementDeadlineForRole(monthStr, role)
 *     → Same but resolved against an explicit role ('EMPLOYEE' | 'RA').
 *       Useful for pages that display both role deadlines side-by-side.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EXTENSION CEILING (synchronous, no API call)
 * ─────────────────────────────────────────────────────────────────────────
 *   getExtensionCeiling(type, role, monthStr)
 *     → Returns the latest Date an RA can pick when granting an extension.
 *       type = 'PLAN' | 'ACHIEVEMENT'. Mirrors backend getExtensionCeiling().
 *       Safe to call synchronously — uses local EXTENSION_CEILING_DEFAULTS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EFFECTIVE DEADLINE HELPERS (extension-aware, async, RA/MD-only endpoint)
 * ─────────────────────────────────────────────────────────────────────────
 *   getEffectivePlanDeadline(employeeId, monthStr, [empRole])
 *   getEffectiveAchievementDeadline(employeeId, monthStr, [empRole])
 *     → Both return a Promise<{ effectiveDeadline, isExtended, extensionCount,
 *       baseDeadline, maxDate }>. Call these inside useEffect or event handlers.
 *       If the fetch fails (e.g. employee calling an RA-only endpoint), they
 *       fall back to the base deadline silently — pages never crash.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BOOLEAN HELPERS (own role, BASE deadline — synchronous)
 * ─────────────────────────────────────────────────────────────────────────
 *   isBeforePlanDeadline(monthStr)
 *   isAfterAchievementStart(monthStr)
 *   isBeforeAchievementDeadline(monthStr)
 *   isWithinAchievementWindow(monthStr)
 *     → Boolean gate-checks against the BASE (non-extended) deadline.
 *       For extension-aware gates, await getEffectivePlanDeadline() or
 *       getEffectiveAchievementDeadline() and compare manually.
 *
 *   resolvedAchievementDay(monthStr)
 *     → Concrete day number for the achievement deadline. Resolves "last" to
 *       the actual last day of the TARGET month (post-offset), not the plan's
 *       own month — important when achievementDeadlineMonthOffset > 0.
 */
export function useDeadlines() {
  const context = useContext(DeadlineContext);
  if (!context) {
    throw new Error('useDeadlines must be used within a DeadlineProvider');
  }
  return context;
}

export default DeadlineContext;