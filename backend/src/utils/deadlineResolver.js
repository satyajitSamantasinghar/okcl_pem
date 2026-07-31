/**
 * deadlineResolver.js
 *
 * Single source of truth for "what deadline actually applies right now."
 * Used by:
 *   - dateMiddleware.js  (enforcement — plan & achievement submission)
 *   - raController.js   (extendDeadline hardening, getDeadlineManagement,
 *                         getMissedDeadlines, getExtendDeadlineContext)
 *
 * Both functions are async (they query the DB) and are imported wherever
 * "is this extended?" or "what is the full audit history?" needs answering.
 * No other file replicates this logic — Section 4, rule 2.
 */

const { DeadlineExtension, User } = require("../models");
const { Op } = require("sequelize");

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

module.exports = { getEffectiveDeadline, getExtensionHistory };
