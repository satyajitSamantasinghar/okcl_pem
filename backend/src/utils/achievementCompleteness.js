'use strict';

/* ─── isAchievementCompleteForPlan(planItemCount, achievementItemCount) ────
   MOVED HERE from raController.js so it has exactly one implementation.
   Originally this rule lived only in raController.js (used by the
   evaluate-authorization guard and the RA list/detail endpoints). It is
   now also needed by services/reminderService.js's achievement-reminder
   job, and duplicating a second copy there would risk the same
   duplicated-logic-drift bug pattern this project has hit before (see the
   Sep 2026 Progress/Status-filter work, where a duplicated inline badge
   classifier was refactored into a single `getProgressStatus` for the
   same reason). Both raController.js and reminderService.js import this
   one function instead.

   "Add More Plans" lets an employee append plan items to an already-
   submitted plan at any point before evaluation; "Add More Progress"
   mirrors that on the achievement side. Between the two actions, a plan
   can legitimately have more MonthlyPlanItem rows than its already-
   SUBMITTED MonthlyAchievement has MonthlyAchievementItem rows — the
   achievement's `status` column stays "SUBMITTED" from that earlier,
   smaller submission until the employee separately submits progress for
   the new item(s). A naive existence check (does a SUBMITTED achievement
   exist at all?) therefore wrongly treats progress as fully reported the
   moment ANY achievement is submitted, even one that predates a later-
   added, still-unreported plan item.

   The employee's "Add More Progress" flow always appends exactly one new
   MonthlyAchievementItem per new MonthlyPlanItem (see the "ADD MORE
   PROGRESS" block in employeeController.submitMonthlyAchievement), so a
   plain item-count comparison is sufficient to detect the gap — no need
   to resolve individual planItemId links here.

   planItemCount === 0 means this plan predates the MonthlyPlanItem table
   (pure legacy planDetails text with no structured items) — there's
   nothing to compare per-item, so we fall back to the original
   existence-only behavior rather than blocking evaluation (or, in
   reminderService.js, sending a reminder) for data this feature doesn't
   apply to. */
function isAchievementCompleteForPlan(planItemCount, achievementItemCount) {
    if (!planItemCount) return true;
    return achievementItemCount >= planItemCount;
}

module.exports = { isAchievementCompleteForPlan };