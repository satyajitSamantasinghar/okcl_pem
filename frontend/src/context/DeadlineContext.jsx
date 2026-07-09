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
 *   planDay        = 10   (10th of the month)
 *   achievementDay = "last" (last calendar day of the month)
 *
 * SOURCE OF TRUTH
 * ────────────────
 * The backend reads its values from .env:
 *   MONTHLY_PLAN_DEADLINE_DAY=10
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
  achievementDay: 'last', // "last" = last calendar day of the month
};

/* ── Context ── */
const DeadlineContext = createContext({
  planDay: DEADLINE_DEFAULTS.planDay,
  achievementDay: DEADLINE_DEFAULTS.achievementDay,
  isLoading: true,

  /** Returns a Date object set to end-of-day on the plan deadline for a given YYYY-MM string. */
  getPlanDeadline: (_monthStr) => null,

  /** Returns a Date object set to end-of-day on the achievement deadline for a given YYYY-MM string. */
  getAchievementDeadline: (_monthStr) => null,

  /** Returns true if today is on or before the plan deadline for the given YYYY-MM string. */
  isBeforePlanDeadline: (_monthStr) => true,

  /** Returns true if today is on or before the achievement deadline for the given YYYY-MM string. */
  isBeforeAchievementDeadline: (_monthStr) => true,

  /** Returns the day number for the achievement deadline for a given YYYY-MM string.
   *  When achievementDay === "last" this returns the actual last day of that month. */
  resolvedAchievementDay: (_monthStr) => null,
});

/* ── Provider ── */
export function DeadlineProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [config, setConfig] = useState({
    planDay: DEADLINE_DEFAULTS.planDay,
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

        const achievementDay =
          data.achievementDay === 'last' ||
          (typeof data.achievementDay === 'number' &&
            data.achievementDay >= 1 &&
            data.achievementDay <= 31)
            ? data.achievementDay
            : DEADLINE_DEFAULTS.achievementDay;

        setConfig({ planDay, achievementDay, isLoading: false });
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
    return new Date(y, m - 1, config.planDay, 23, 59, 59, 999);
  }

  /* ── Build a Date for achievement deadline (end of that day) ── */
  function getAchievementDeadline(monthStr) {
    if (!monthStr) return null;
    const [y, m] = monthStr.split('-').map(Number);
    if (!y || !m) return null;
    const day = resolvedAchievementDay(monthStr);
    return new Date(y, m - 1, day, 23, 59, 59, 999);
  }

  /* ── Boolean helpers ── */
  function isBeforePlanDeadline(monthStr) {
    const deadline = getPlanDeadline(monthStr);
    if (!deadline) return true;
    return new Date() <= deadline;
  }

  function isBeforeAchievementDeadline(monthStr) {
    const deadline = getAchievementDeadline(monthStr);
    if (!deadline) return true;
    return new Date() <= deadline;
  }

  const value = {
    planDay: config.planDay,
    achievementDay: config.achievementDay,
    isLoading: config.isLoading,
    getPlanDeadline,
    getAchievementDeadline,
    isBeforePlanDeadline,
    isBeforeAchievementDeadline,
    resolvedAchievementDay,
  };

  return <DeadlineContext.Provider value={value}>{children}</DeadlineContext.Provider>;
}

/* ── Hook ── */
export function useDeadlines() {
  return useContext(DeadlineContext);
}

export default DeadlineContext;
