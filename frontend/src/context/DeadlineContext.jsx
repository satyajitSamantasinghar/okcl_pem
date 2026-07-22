/**
 * DeadlineContext.jsx
 *
 * Centralized, dynamic monthly deadline configuration for the entire frontend.
 *
 * ARCHITECTURE
 * ────────────
 * Fetches GET /api/config/deadlines once when the authenticated user session
 * starts (inside DeadlineProvider).  All pages and components consume the
 * values via the useDeadlines() hook — no page ever hardcodes a day number.
 *
 * If the API call fails (network error, server down), the context gracefully
 * falls back to the canonical defaults:
 *   planDay             = 10   (10th of the month)
 *   achievementStartDay = 11   (11th of the month — the day after the plan
 *                                deadline, so achievements can't be logged
 *                                before that month's plan is locked in)
 *   achievementDay      = "last" (last calendar day of the month)
 *
 * WINDOW SEMANTICS
 * ─────────────────
 * The achievement submission window is bounded on both sides now:
 *   • getAchievementWindowStart() / isAfterAchievementStart()  → opening bound
 *   • getAchievementDeadline()    / isBeforeAchievementDeadline() → closing bound
 *   • isWithinAchievementWindow() combines both, for pages that just need a
 *     single yes/no answer.
 *
 * SOURCE OF TRUTH
 * ────────────────
 * The backend reads its values from .env:
 *   MONTHLY_PLAN_DEADLINE_DAY=10
 *   MONTHLY_ACHIEVEMENT_START_DAY=11
 *   MONTHLY_ACHIEVEMENT_DEADLINE_DAY=last
 *
 * Changing these in .env and restarting the server automatically updates
 * every page in the UI on the next load — no frontend code changes needed.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

/* ── Canonical defaults (used when API is unavailable) ── */
export const DEADLINE_DEFAULTS = {
  planDay: 10,
  achievementStartDay: 11, // opens the day after the plan deadline, by default
  achievementDay: 'last', // "last" = last calendar day of the month
};

/* ── Context ── */
const DeadlineContext = createContext({
  planDay: DEADLINE_DEFAULTS.planDay,
  achievementStartDay: DEADLINE_DEFAULTS.achievementStartDay,
  achievementDay: DEADLINE_DEFAULTS.achievementDay,
  isLoading: true,

  /** Returns a Date object set to end-of-day on the plan deadline for a given YYYY-MM string. */
  getPlanDeadline: (_monthStr) => null,

  /** Returns a Date object set to start-of-day on the achievement window's opening day for a given YYYY-MM string. */
  getAchievementWindowStart: (_monthStr) => null,

  /** Returns a Date object set to end-of-day on the achievement deadline for a given YYYY-MM string. */
  getAchievementDeadline: (_monthStr) => null,

  /** Returns true if today is on or before the plan deadline for the given YYYY-MM string. */
  isBeforePlanDeadline: (_monthStr) => true,

  /** Returns true if today is on or after the achievement window's opening day for the given YYYY-MM string. */
  isAfterAchievementStart: (_monthStr) => true,

  /** Returns true if today is on or before the achievement deadline for the given YYYY-MM string. */
  isBeforeAchievementDeadline: (_monthStr) => true,

  /** Returns true if today falls within the achievement submission window (open AND not yet closed) for the given YYYY-MM string. */
  isWithinAchievementWindow: (_monthStr) => true,

  /** Returns the day number for the achievement deadline for a given YYYY-MM string.
   *  When achievementDay === "last" this returns the actual last day of that month. */
  resolvedAchievementDay: (_monthStr) => null,
});

/* ── Provider ── */
export function DeadlineProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [config, setConfig] = useState({
    planDay: DEADLINE_DEFAULTS.planDay,
    achievementStartDay: DEADLINE_DEFAULTS.achievementStartDay,
    achievementDay: DEADLINE_DEFAULTS.achievementDay,
    isLoading: true,
  });

  useEffect(() => {
    // Only fetch once the user is authenticated (JWT is available)
    if (!isAuthenticated) return;

    let cancelled = false;

    api
      .get('/config/deadlines')
      .then(({ data }) => {
        if (cancelled) return;
        const planDay =
          typeof data.planDay === 'number' && data.planDay >= 1 && data.planDay <= 31
            ? data.planDay
            : DEADLINE_DEFAULTS.planDay;

        const achievementStartDay =
          typeof data.achievementStartDay === 'number' &&
          data.achievementStartDay >= 1 &&
          data.achievementStartDay <= 31
            ? data.achievementStartDay
            : DEADLINE_DEFAULTS.achievementStartDay;

        const achievementDay =
          data.achievementDay === 'last' ||
          (typeof data.achievementDay === 'number' &&
            data.achievementDay >= 1 &&
            data.achievementDay <= 31)
            ? data.achievementDay
            : DEADLINE_DEFAULTS.achievementDay;

        setConfig({ planDay, achievementStartDay, achievementDay, isLoading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(
          '[DeadlineContext] Could not fetch deadline config — using defaults.',
          err?.message
        );
        setConfig((prev) => ({ ...prev, isLoading: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  /* ── Utility: last day of a calendar month ── */
  function lastDayOfMonth(year, month /* 1-based */) {
    // new Date(year, month, 0) = last day of (month-1)+1 = last day of `month`
    return new Date(year, month, 0).getDate();
  }

  /* ── Utility: build a Date for a given day-of-month, clamped to the real
     number of days in that month (e.g. day 31 in February safely becomes
     Feb 28/29 instead of silently rolling over into March). ── */
  function buildClampedDate(year, month /* 1-based */, day, endOfDay) {
    const safeDay = Math.min(day, lastDayOfMonth(year, month));
    return endOfDay
      ? new Date(year, month - 1, safeDay, 23, 59, 59, 999)
      : new Date(year, month - 1, safeDay, 0, 0, 0, 0);
  }

  /* ── Resolve the concrete day number for achievement deadline ── */
  function resolvedAchievementDay(monthStr) {
    if (!monthStr) return null;
    const [y, m] = monthStr.split('-').map(Number);
    if (!y || !m) return null;
    return config.achievementDay === 'last'
      ? lastDayOfMonth(y, m)
      : config.achievementDay;
  }

  /* ── Build a Date for plan deadline (end of that day) ── */
  function getPlanDeadline(monthStr) {
    if (!monthStr) return null;
    const [y, m] = monthStr.split('-').map(Number);
    if (!y || !m) return null;
    return buildClampedDate(y, m, config.planDay, true);
  }

  /* ── Build a Date for the achievement window's opening day (start of that day) ── */
  function getAchievementWindowStart(monthStr) {
    if (!monthStr) return null;
    const [y, m] = monthStr.split('-').map(Number);
    if (!y || !m) return null;
    return buildClampedDate(y, m, config.achievementStartDay, false);
  }

  /* ── Build a Date for achievement deadline (end of that day) ── */
  function getAchievementDeadline(monthStr) {
    if (!monthStr) return null;
    const [y, m] = monthStr.split('-').map(Number);
    if (!y || !m) return null;
    const day = resolvedAchievementDay(monthStr);
    return buildClampedDate(y, m, day, true);
  }

  /* ── Boolean helpers ── */
  function isBeforePlanDeadline(monthStr) {
    const deadline = getPlanDeadline(monthStr);
    if (!deadline) return true;
    return new Date() <= deadline;
  }

  function isAfterAchievementStart(monthStr) {
    const start = getAchievementWindowStart(monthStr);
    if (!start) return true;
    return new Date() >= start;
  }

  function isBeforeAchievementDeadline(monthStr) {
    const deadline = getAchievementDeadline(monthStr);
    if (!deadline) return true;
    return new Date() <= deadline;
  }

  function isWithinAchievementWindow(monthStr) {
    return isAfterAchievementStart(monthStr) && isBeforeAchievementDeadline(monthStr);
  }

  const value = {
    planDay: config.planDay,
    achievementStartDay: config.achievementStartDay,
    achievementDay: config.achievementDay,
    isLoading: config.isLoading,
    getPlanDeadline,
    getAchievementWindowStart,
    getAchievementDeadline,
    isBeforePlanDeadline,
    isAfterAchievementStart,
    isBeforeAchievementDeadline,
    isWithinAchievementWindow,
    resolvedAchievementDay,
  };

  return <DeadlineContext.Provider value={value}>{children}</DeadlineContext.Provider>;
}

/* ── Hook ── */
export function useDeadlines() {
  return useContext(DeadlineContext);
}

export default DeadlineContext;