const { Op } = require("sequelize");
const { UserStatusHistory } = require("../models");

// ─────────────────────────────────────────────────────────────────────────────
//  filterActiveDuringMonth(userIds, month)
//
//  Returns the subset of `userIds` that were active (isActive: true) at ANY
//  point during `month` ("YYYY-MM"), based on UserStatusHistory — never the
//  live User.isActive snapshot.
//
//  This is the single shared implementation of the month-overlap check.
//  adminController.js and raController.js both call this instead of each
//  hand-deriving the condition — same anti-duplication reasoning as
//  isAchievementCompleteForPlan (utils/achievementCompleteness.js).
//
//  Overlap condition — identical shape to the EmployeeRAHistory date-overlap
//  query already used throughout raController.js/adminController.js
//  (getRADashboard, fetchEmployeeIdsByRAForMonth, etc.):
//    effectiveFrom <= end of month
//    AND (effectiveTo IS NULL OR effectiveTo >= start of month)
//
//  A user deactivated mid-September still counts as active FOR September
//  (they were active for part of it) but not for October onward — matching
//  how EmployeeRAHistory already treats a mid-month RA reassignment.
// ─────────────────────────────────────────────────────────────────────────────
async function filterActiveDuringMonth(userIds, month) {
  if (!userIds || userIds.length === 0) return [];

  const [year, mon] = month.split("-").map(Number);
  const startOfMonth = new Date(year, mon - 1, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(year, mon, 0, 23, 59, 59, 999);

  const rows = await UserStatusHistory.findAll({
    where: {
      userId: { [Op.in]: userIds },
      isActive: true,
      effectiveFrom: { [Op.lte]: endOfMonth },
      [Op.or]: [
        { effectiveTo: null },
        { effectiveTo: { [Op.gte]: startOfMonth } },
      ],
    },
    attributes: ["userId"],
  });

  return [...new Set(rows.map((r) => r.userId))];
}

module.exports = { filterActiveDuringMonth };