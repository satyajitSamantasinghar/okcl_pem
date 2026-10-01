/**
 * deadlineResolver.js
 *
 * Single source of truth for "what deadline actually applies right now."
 * Used by:
 *   - dateMiddleware.js  (enforcement — plan & achievement submission)
 *   - raController.js   (extendDeadline hardening, getDeadlineManagement,
 *                         getMissedDeadlines, getExtendDeadlineContext,
 *                         submitMonthlyEvaluation / getMonthlyEvaluationById
 *                         / submitPlanFeedback — via getEvaluationOpensAt)
 *
 * All three functions are async (they query the DB) and are imported
 * wherever "is this extended?", "what is the full audit history?", or
 * "when can this be evaluated?" needs answering.
 * No other file replicates this logic — Section 4, rule 2.
 */

const { DeadlineExtension, User } = require("../models");
const { Op } = require("sequelize");
const { computeAchievementWindow } = require("./dateHelpers");

/**
 * getEffectiveDeadline
 *
 * Looks up the most recent DeadlineExtension row for the given
 * (employeeId, month, year, type) key.  If one exists its newDeadline
 * is returned as the authoritative deadline; otherwise baseDeadline is
 * returned unchanged.
 *
 * @param {{ employeeId: string, month: number, year: number,
 *           type: "PLAN"|"ACHIEVEMENT", baseDeadline: Date }} params
 * @returns {Promise<{
 *   effectiveDeadline: Date,
 *   isExtended: boolean,
 *   extensionCount: number,
 *   lastExtension: object|null
 * }>}
 */
async function getEffectiveDeadline({ employeeId, month, year, type, baseDeadline }) {
  // Fetch all extensions for this key so we can return the count as well
  const extensions = await DeadlineExtension.findAll({
    where: {
      employeeId,
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      type: type.toUpperCase(),
    },
    order: [["createdAt", "DESC"]],
  });

  if (!extensions || extensions.length === 0) {
    return {
      effectiveDeadline: baseDeadline,
      isExtended: false,
      extensionCount: 0,
      lastExtension: null,
    };
  }

  // Most recent extension row (first after DESC sort) is authoritative
  const latest = extensions[0];

  // newDeadline is stored as DATEONLY ("YYYY-MM-DD") — parse as end-of-day
  // local time so the comparison is conservative (allows the full day).
  const newDeadlineStr = latest.newDeadline; // e.g. "2026-07-31"
  const [dy, dm, dd] = newDeadlineStr.split("-").map(Number);
  const effectiveDeadline = new Date(dy, dm - 1, dd, 23, 59, 59, 999);

  return {
    effectiveDeadline,
    isExtended: true,
    extensionCount: extensions.length,
    lastExtension: latest,
  };
}

/**
 * getExtensionHistory
 *
 * Returns all DeadlineExtension rows for a given
 * (employeeId, month, year, type) key, ordered oldest-first,
 * each enriched with the extender's name.
 *
 * Used by the audit-trail views (history modal, context endpoint).
 *
 * @param {{ employeeId: string, month: number, year: number, type: string }} params
 * @returns {Promise<Array<{
 *   id: string,
 *   oldDeadline: string,
 *   newDeadline: string,
 *   reason: string,
 *   extendedByName: string,
 *   notifiedEmployee: boolean,
 *   createdAt: Date
 * }>>}
 */
async function getExtensionHistory({ employeeId, month, year, type }) {
  const rows = await DeadlineExtension.findAll({
    where: {
      employeeId,
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      type: type.toUpperCase(),
    },
    include: [
      {
        model: User,
        as: "extendedBy",
        attributes: ["id", "name"],
      },
    ],
    order: [["createdAt", "ASC"]],
  });

  return rows.map((row) => ({
    id: row.id,
    oldDeadline: row.oldDeadline,
    newDeadline: row.newDeadline,
    reason: row.reason,
    extendedByName: row.extendedBy?.name || "Unknown",
    notifiedEmployee: row.notifiedEmployee,
    createdAt: row.createdAt,
  }));
}

/**
 * getEvaluationOpensAt
 *
 * Single source of truth for "when may this monthly record actually be
 * evaluated." Returns the instant immediately AFTER the plan owner's
 * achievement submission window closes for that record's own month —
 * i.e. evaluation opens the day the achievement window ends, taking any
 * active DeadlineExtension into account via getEffectiveDeadline (so
 * evaluation can never unlock before the employee's ACTUAL, possibly
 * extended, deadline — the same deadline allowMonthlyAchievementSubmission
 * enforces on the submission side).
 *
 * For a regular EMPLOYEE (achievementDay: "last", offset 0) this resolves
 * to the 1st of the following month. For an RA's own plan (achievementDay:
 * 3, offset 1 — see configController.js), it correctly resolves to the 4th
 * of the month after next, NOT a hardcoded "1st" — so an MD evaluating an
 * RA's own monthly plan can never do so before the RA's own (later)
 * achievement deadline has actually closed.
 *
 * @param {{ employeeId: string, month: string,
 *           config: ReturnType<typeof import('../controllers/configController').parseDeadlineConfig> }} params
 *   `config` must already be resolved by the CALLER for the PLAN OWNER's
 *   role (not the evaluator's) — deliberately not resolved in here, so
 *   this file's import list stays limited to models + dateHelpers, matching
 *   its existing convention (see header comment).
 * @returns {Promise<Date>}
 */
async function getEvaluationOpensAt({ employeeId, month, config }) {
  const [year, mo] = month.split("-").map(Number);
  const { windowEnd } = computeAchievementWindow(month, config);

  const { effectiveDeadline } = await getEffectiveDeadline({
    employeeId,
    month: mo,
    year,
    type: "ACHIEVEMENT",
    baseDeadline: windowEnd,
  });

  return new Date(effectiveDeadline.getTime() + 1);
}

module.exports = { getEffectiveDeadline, getExtensionHistory, getEvaluationOpensAt };