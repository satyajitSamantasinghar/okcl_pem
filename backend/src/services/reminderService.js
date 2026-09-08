'use strict';

/**
 * reminderService.js
 *
 * Deadline-reminder job for Monthly Plan and Monthly Achievement (Progress)
 * submissions. Invoked on a schedule (wired in server.js via node-cron) and
 * emails any employee/RA who has NOT yet submitted, once their effective
 * deadline is within a configured number of days.
 *
 * SINGLE SOURCE OF TRUTH — this reuses the exact same deadline logic already
 * used to ENFORCE deadlines, instead of recomputing it independently:
 *   - parseDeadlineConfig / normalizeRole    (controllers/configController.js)
 *   - buildDeadlineDate / computeAchievementWindow (utils/dateHelpers.js)
 *   - getEffectiveDeadline                   (utils/deadlineResolver.js — applies RA extensions)
 * This is the same set dateMiddleware.js uses to allow/reject a submission,
 * so a reminder can never claim a deadline that enforcement would disagree
 * with.
 *
 * SCOPE — deliberate boundaries, called out so they're not mistaken for
 * oversights:
 *   - Reminds BEFORE a deadline only. An already-missed deadline is a
 *     separate, RA-facing concern (see raController.js's missed-deadlines
 *     aggregation, referenced in dateHelpers.js's header) and is not
 *     re-implemented here.
 *   - A REJECTED Monthly Plan is excluded from PLAN reminders: rejection
 *     bypasses the normal deadline entirely (dateMiddleware.js's "Rejection
 *     Resubmission Bypass" — resubmission is allowed at any time), so there
 *     is no deadline left to "near." A rejected-and-awaiting-resubmission
 *     notice would be a different, non-deadline-based reminder — out of
 *     scope here.
 *   - A resubmitted Monthly Plan (version > 1) is excluded from ACHIEVEMENT
 *     reminders for the same reason: allowMonthlyAchievementSubmission
 *     bypasses ALL date checks once version > 1, so there is no enforced
 *     achievement deadline to remind about.
 *   - Only roles EMPLOYEE and RA are considered — the only two roles
 *     parseDeadlineConfig actually has dedicated deadline configs for
 *     (HRD/MD fall back to the EMPLOYEE config only as a safety net, not
 *     because they're expected to hold this obligation).
 *   - ACHIEVEMENT reminders are COMPLETENESS-aware, not just existence-
 *     aware. A SUBMITTED MonthlyAchievement is not necessarily done: "Add
 *     More Plans" can append plan item(s) to an already-submitted plan at
 *     any point before evaluation, and the achievement's `status` stays
 *     "SUBMITTED" from an earlier, smaller submission until progress is
 *     separately submitted for the new item(s) via "Add More Progress"
 *     (see utils/achievementCompleteness.js's isAchievementCompleteForPlan
 *     — the exact same rule raController.js's evaluate-authorization guard
 *     uses, imported rather than reimplemented so this job can never
 *     disagree with what actually blocks evaluation). A plan therefore
 *     still gets an achievement reminder if its SUBMITTED achievement is
 *     missing progress for one or more newly-added items — worded
 *     differently from the "nothing submitted yet" case via
 *     notifyIncompleteAchievementReminder, since telling someone who
 *     already submitted most of their progress "you have not yet
 *     submitted" would be inaccurate and confusing.
 *
 * DEDUPE — a ReminderLog row (employeeId, month, type, thresholdDays) is
 * unique at the DB level (see models/ReminderLog.js), so even if the cron
 * fires twice, or two instances race, each (employee, record-month, type,
 * threshold) reminder is sent at most once.
 */

const { Op } = require("sequelize");
const { User, MonthlyPlan, MonthlyPlanItem, MonthlyAchievement, MonthlyAchievementItem, ReminderLog } = require("../models");
const { parseDeadlineConfig, normalizeRole } = require("../controllers/configController");
const { buildDeadlineDate, computeAchievementWindow, formatPeriod, formatDeadline } = require("../utils/dateHelpers");
const { getEffectiveDeadline } = require("../utils/deadlineResolver");
const { notifyDeadlineReminder, notifyIncompleteAchievementReminder } = require("./notificationService");
// Single source of truth for "is a SUBMITTED achievement actually complete
// for its plan" — same helper raController.js's evaluate-authorization
// guard uses, moved out to ../utils/achievementCompleteness so this job
// can't silently drift from what actually gates evaluation.
const { isAchievementCompleteForPlan } = require("../utils/achievementCompleteness");

const REMINDABLE_ROLES = ["EMPLOYEE", "RA"];

// How many calendar months back an achievement record can still have an
// open window. configController's MONTHLY_ACHIEVEMENT_EXTENSION_MAX_MONTH_OFFSET_*
// vars are capped at MAX_MONTH_OFFSET (currently 2), so 3 (0, 1, and 2
// months back) safely covers every record whose window could still be open,
// with no hardcoded guess involved.
const ACHIEVEMENT_LOOKBACK_MONTHS = 3;

/* ════════════════════════════════════════════════════════════════════
   HELPER — "YYYY-MM" key for the month `monthsBack` calendar months
   before `now`. Deliberately plain Date arithmetic rather than reusing
   dateHelpers.addCalendarMonths: that helper is only ever called with
   offset >= 0 today (configController's readMonthOffsetEnv enforces
   0..MAX_MONTH_OFFSET), and its modulo step
   (`(zeroBasedTotal % 12) + 1`) is not verified correct for a negative
   offset in JS (negative % 12 stays negative). Rather than pass an
   unverified negative offset into a shared helper four other files rely
   on, this stays local and self-contained. Worth a look if dateHelpers.js
   is ever revisited — flagging, not silently patching shared code as
   part of an unrelated feature.
════════════════════════════════════════════════════════════════════ */
function monthKeyMonthsAgo(now, monthsBack) {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ════════════════════════════════════════════════════════════════════
   Which day-counts before a deadline trigger a reminder.
   REMINDER_THRESHOLD_DAYS="3,1"  → remind 3 days before AND 1 day before.
   Invalid/missing entries are dropped with a warning; falls back to
   [3, 1] if nothing valid remains — mirrors configController's
   readIntEnv fallback style.
════════════════════════════════════════════════════════════════════ */
function getThresholdDays() {
    const raw = process.env.REMINDER_THRESHOLD_DAYS;
    if (!raw || !raw.trim()) return [3, 1];

    const parsed = raw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 0);

    if (parsed.length === 0) {
        console.warn(`[reminder] Invalid REMINDER_THRESHOLD_DAYS="${raw}". Falling back to 3,1.`);
        return [3, 1];
    }
    return [...new Set(parsed)];
}

/* ════════════════════════════════════════════════════════════════════
   Calendar-day distance to a deadline, ignoring time-of-day, so a job
   that runs at any hour still matches whole-day thresholds consistently.
   effectiveDeadline is always end-of-day (23:59:59.999) — see
   buildDeadlineDate(..., endOfDay=true) — so this compares "today" to
   "the deadline's calendar date."
════════════════════════════════════════════════════════════════════ */
function daysUntil(deadline, now) {
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deadlineMidnight = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
    return Math.round((deadlineMidnight - todayMidnight) / 86400000);
}

/* ════════════════════════════════════════════════════════════════════
   Has a reminder for this exact (employee, month, type, threshold)
   already been sent? Belt-and-suspenders alongside the DB unique index —
   this avoids attempting an email send we'd have to discard anyway.
════════════════════════════════════════════════════════════════════ */
async function alreadySent(employeeId, month, type, thresholdDays) {
    const existing = await ReminderLog.findOne({
        where: { employeeId, month, type, thresholdDays },
        attributes: ["id"],
    });
    return !!existing;
}

/* ════════════════════════════════════════════════════════════════════
   Records the reminder as sent. Relies on the unique index (not a
   transaction) to reject a racing duplicate insert — reminders are
   independent rows, so no cross-row atomicity is needed. Mirrors
   DeadlineExtension's immutable, insert-only pattern.
════════════════════════════════════════════════════════════════════ */
async function recordSent(employeeId, month, type, thresholdDays, effectiveDeadline) {
    try {
        await ReminderLog.create({ employeeId, month, type, thresholdDays, effectiveDeadline });
    } catch (err) {
        // Unique constraint hit = another run already logged this reminder
        // concurrently. The email either also raced (harmless, rare duplicate)
        // or this call simply lost the race cleanly — neither is worth
        // surfacing as an error.
        if (err.name !== "SequelizeUniqueConstraintError") throw err;
    }
}

/* ════════════════════════════════════════════════════════════════════
   PLAN reminders — employees/RAs with no PENDING/APPROVED Monthly Plan
   for the current month yet (no row at all, or only a DRAFT row).
   REJECTED is intentionally excluded — see module docstring.
════════════════════════════════════════════════════════════════════ */
async function sendPlanReminders(thresholds, now) {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const currentMonth = `${year}-${String(month).padStart(2, "0")}`;

    const users = await User.findAll({
        where: { isActive: true, role: { [Op.in]: REMINDABLE_ROLES } },
        attributes: ["id", "name", "email", "role"],
        include: [
            {
                model: MonthlyPlan,
                as: "monthlyPlans",
                required: false,
                where: { month: currentMonth },
                attributes: ["id", "status"],
            },
        ],
    });

    let sentCount = 0;

    for (const user of users) {
        const row = user.monthlyPlans && user.monthlyPlans[0];
        // Already submitted (PENDING/APPROVED) → nothing to remind about.
        // REJECTED → different flow, no enforced deadline (see docstring).
        if (row && row.status !== "DRAFT") continue;

        const role = normalizeRole(user.role);
        const config = parseDeadlineConfig(role);
        const baseDeadline = buildDeadlineDate(year, month, config.planDay, 0, true);

        let effectiveDeadline;
        try {
            ({ effectiveDeadline } = await getEffectiveDeadline({
                employeeId: user.id,
                month,
                year,
                type: "PLAN",
                baseDeadline,
            }));
        } catch (err) {
            console.error(`[reminder] Failed to resolve PLAN deadline for user ${user.id}:`, err.message);
            continue;
        }

        const remaining = daysUntil(effectiveDeadline, now);
        if (remaining < 0 || !thresholds.includes(remaining)) continue;
        if (await alreadySent(user.id, currentMonth, "PLAN", remaining)) continue;

        const result = await notifyDeadlineReminder({
            employee: user,
            type: "Monthly Plan",
            period: formatPeriod(currentMonth),
            deadlineLabel: formatDeadline(effectiveDeadline.toISOString().split("T")[0]),
            daysRemaining: remaining,
        });

        if (result.success) {
            await recordSent(user.id, currentMonth, "PLAN", remaining, effectiveDeadline);
            sentCount++;
        }
    }

    return sentCount;
}

/* ════════════════════════════════════════════════════════════════════
   ACHIEVEMENT reminders — Monthly Plans (status PENDING/APPROVED,
   version 1 only — see module docstring) from the last
   ACHIEVEMENT_LOOKBACK_MONTHS months whose achievement window is open
   AND whose achievement is not COMPLETE — i.e. either nothing has been
   submitted at all, or a SUBMITTED achievement is missing progress for
   plan item(s) added later via "Add More Plans" (see module docstring
   and utils/achievementCompleteness.js). A plan with a SUBMITTED
   achievement that covers every current plan item is fully done and is
   skipped, same as before.
════════════════════════════════════════════════════════════════════ */
async function sendAchievementReminders(thresholds, now) {
    const monthsToCheck = [];
    for (let back = 0; back < ACHIEVEMENT_LOOKBACK_MONTHS; back++) {
        monthsToCheck.push(monthKeyMonthsAgo(now, back));
    }

    const plans = await MonthlyPlan.findAll({
        where: {
            month: { [Op.in]: monthsToCheck },
            status: { [Op.in]: ["PENDING", "APPROVED"] },
            version: 1, // resubmitted plans bypass the achievement deadline entirely — see docstring
        },
        attributes: ["id", "employeeId", "month"],
        include: [
            { model: User, as: "employee", attributes: ["id", "name", "email", "role", "isActive"] },
            { model: MonthlyAchievement, as: "achievement", required: false, attributes: ["id", "status"] },
        ],
    });

    let sentCount = 0;

    for (const plan of plans) {
        const employee = plan.employee;
        if (!employee || !employee.isActive || !REMINDABLE_ROLES.includes(employee.role)) continue;

        const achievement = plan.achievement;
        const achievementSubmitted = !!achievement && achievement.status === "SUBMITTED";

        // How many plan items still have no matching progress reported.
        // Stays 0 (→ the "nothing submitted yet" branch below) unless a
        // SUBMITTED achievement exists but is short of the plan's current
        // item count — see isAchievementCompleteForPlan for the rule.
        let missingCount = 0;
        if (achievementSubmitted) {
            const [planItemCount, achievementItemCount] = await Promise.all([
                MonthlyPlanItem.count({ where: { monthlyPlanId: plan.id } }),
                MonthlyAchievementItem.count({ where: { monthlyAchievementId: achievement.id } }),
            ]);
            if (isAchievementCompleteForPlan(planItemCount, achievementItemCount)) continue; // fully done — nothing to remind about
            missingCount = Math.max(planItemCount - achievementItemCount, 0);
        }

        const role = normalizeRole(employee.role);
        const config = parseDeadlineConfig(role);
        const { windowStart, windowEnd } = computeAchievementWindow(plan.month, config);
        if (now < windowStart) continue; // window hasn't opened yet — nothing to remind about

        const [yearStr, monthStr] = plan.month.split("-");
        let effectiveDeadline;
        try {
            ({ effectiveDeadline } = await getEffectiveDeadline({
                employeeId: employee.id,
                month: parseInt(monthStr, 10),
                year: parseInt(yearStr, 10),
                type: "ACHIEVEMENT",
                baseDeadline: windowEnd,
            }));
        } catch (err) {
            console.error(`[reminder] Failed to resolve ACHIEVEMENT deadline for plan ${plan.id}:`, err.message);
            continue;
        }

        const remaining = daysUntil(effectiveDeadline, now);
        if (remaining < 0 || !thresholds.includes(remaining)) continue;
        // One dedupe key covers both branches below — an employee should get
        // at most one achievement-completeness reminder per (month,
        // threshold) regardless of whether the cause is "nothing submitted"
        // or "submitted but incomplete."
        if (await alreadySent(employee.id, plan.month, "ACHIEVEMENT", remaining)) continue;

        const result = missingCount > 0
            ? await notifyIncompleteAchievementReminder({
                employee,
                period: formatPeriod(plan.month),
                deadlineLabel: formatDeadline(effectiveDeadline.toISOString().split("T")[0]),
                daysRemaining: remaining,
                missingCount,
            })
            : await notifyDeadlineReminder({
                employee,
                type: "Monthly Achievement",
                period: formatPeriod(plan.month),
                deadlineLabel: formatDeadline(effectiveDeadline.toISOString().split("T")[0]),
                daysRemaining: remaining,
            });

        if (result.success) {
            await recordSent(employee.id, plan.month, "ACHIEVEMENT", remaining, effectiveDeadline);
            sentCount++;
        }
    }

    return sentCount;
}

/* ════════════════════════════════════════════════════════════════════
   Entry point — called on the cron schedule (server.js). Never throws:
   a failed run must not crash the process; it logs and lets the next
   scheduled run try again, matching email.js's "never break the caller"
   philosophy.
════════════════════════════════════════════════════════════════════ */
async function runDeadlineReminders() {
    const thresholds = getThresholdDays();
    const now = new Date();
    console.log(`[reminder] Run started — thresholds: ${thresholds.join(", ")} day(s) before deadline`);

    try {
        const planCount = await sendPlanReminders(thresholds, now);
        const achievementCount = await sendAchievementReminders(thresholds, now);
        console.log(`[reminder] Run complete — ${planCount} plan reminder(s), ${achievementCount} achievement reminder(s) sent`);
    } catch (err) {
        console.error("[reminder] Run failed:", err.message);
    }
}

module.exports = { runDeadlineReminders };