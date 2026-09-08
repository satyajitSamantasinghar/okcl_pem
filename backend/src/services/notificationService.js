'use strict';

const { sendMail } = require('./email');
const { submissionTemplate, additionalItemsTemplate, evaluationTemplate, rejectionTemplate, reminderTemplate, incompleteAchievementReminderTemplate, deadlineExtensionTemplate } = require("./emailTemplates");
const { formatPeriod, formatDeadline } = require('../utils/dateHelpers');

/**
 * Fired when an employee submits their Monthly Plan or Achievement.
 * Notifies the assigned Reporting Authority.
 */
async function notifySubmission({ employee, reportingAuthority, period, type }) {
    if (!reportingAuthority?.email) {
        console.warn(`[notification] No RA email on file — skipped submission notice for employee ${employee?.id}`);
        return { success: false, error: 'RA email missing' };
    }

    const periodLabel = formatPeriod(period);

    return sendMail({
        to: reportingAuthority.email,
        subject: `${type} Submitted — ${employee.name} (${periodLabel})`,
        html: submissionTemplate({
            employeeName: employee.name,
            raName: reportingAuthority.name,
            period: periodLabel,
            type,
        }),
        logLabel: `${type} Submission`,
    });
}

/**
 * Fired when an employee appends new items to a Plan/Achievement that was
 * ALREADY submitted ("Add More Plans" mid-cycle flow). Notifies the assigned
 * Reporting Authority — but with additionalItemsTemplate, not
 * submissionTemplate, since this is a follow-up about newly added items on
 * top of a submission the RA was already notified about, not a new
 * first-time submission.
 */
async function notifyAddition({ employee, reportingAuthority, period, type, itemCount }) {
    if (!reportingAuthority?.email) {
        console.warn(`[notification] No RA email on file — skipped addition notice for employee ${employee?.id}`);
        return { success: false, error: 'RA email missing' };
    }

    const periodLabel = formatPeriod(period);

    return sendMail({
        to: reportingAuthority.email,
        subject: `${itemCount} New Item${itemCount !== 1 ? "s" : ""} Added — ${employee.name} (${periodLabel})`,
        html: additionalItemsTemplate({
            employeeName: employee.name,
            raName: reportingAuthority.name,
            period: periodLabel,
            type,
            itemCount,
        }),
        logLabel: `${type} Addition`,
    });
}

/**
 * Fired when an RA approves or rejects a Plan/Achievement.
 * Notifies the employee.
 */
async function notifyEvaluation({ employee, reportingAuthority, period, type, remarks }) {
    if (!employee?.email) {
        console.warn(`[notification] No employee email on file — skipped evaluation notice for employee ${employee?.id}`);
        return { success: false, error: "Employee email missing" };
    }

    const periodLabel = formatPeriod(period);

    return sendMail({
        to: employee.email,
        subject: `${type} Evaluated — ${periodLabel}`,
        html: evaluationTemplate({
            employeeName: employee.name,
            raName: reportingAuthority?.name || "Your Reporting Authority",
            period: periodLabel,
            type,
            remarks,
        }),
        logLabel: `${type} Evaluation`,
    });
}

async function notifyRejection({ employee, reportingAuthority, period, type, remarks }) {
    if (!employee?.email) {
        console.warn(`[notification] No employee email on file — skipped rejection notice for employee ${employee?.id}`);
        return { success: false, error: "Employee email missing" };
    }

    const periodLabel = formatPeriod(period);

    return sendMail({
        to: employee.email,
        subject: `${type} Rejected — ${periodLabel}`,
        html: rejectionTemplate({
            employeeName: employee.name,
            raName: reportingAuthority?.name || "Your Reporting Authority",
            period: periodLabel,
            type,
            remarks,
        }),
        logLabel: `${type} Rejection`,
    });
}
async function notifyDeadlineExtension({ employee, reportingAuthority, type, period, newDeadline, reason }) {
    if (!employee?.email) {
        console.warn(`[notification] No email on file — skipped deadline extension notice for employee ${employee?.id}`);
        return { success: false, error: "Employee email missing" };
    }

    const periodLabel = formatPeriod(period);
    const deadlineLabel = formatDeadline(newDeadline);

    return sendMail({
        to: employee.email,
        subject: `${type} Deadline Extended — ${periodLabel}`,
        html: deadlineExtensionTemplate({
            employeeName: employee.name,
            raName: reportingAuthority?.name || "Your Reporting Authority",
            type,
            period: periodLabel,
            newDeadline: deadlineLabel,
            reason,
        }),
        logLabel: `${type} Deadline Extension`,
    });
}

/**
 * Fired by reminderService.js's scheduled job when an employee/RA has not
 * yet submitted their Monthly Plan or Achievement and the effective
 * deadline (including any RA-granted extension) is within a configured
 * number of days. Notifies the employee/RA themselves — this is a
 * self-reminder, not an RA-facing notice, so unlike notifySubmission etc.
 * there is no reportingAuthority parameter here.
 */
async function notifyDeadlineReminder({ employee, type, period, deadlineLabel, daysRemaining }) {
    if (!employee?.email) {
        console.warn(`[notification] No email on file — skipped ${type} reminder for employee ${employee?.id}`);
        return { success: false, error: "Employee email missing" };
    }

    const urgency =
        daysRemaining <= 0 ? "today" : daysRemaining === 1 ? "tomorrow" : `in ${daysRemaining} days`;

    return sendMail({
        to: employee.email,
        subject: `Reminder: ${type} for ${period} — due ${urgency}`,
        html: reminderTemplate({
            employeeName: employee.name,
            type,
            period,
            deadlineLabel,
            daysRemaining,
        }),
        logLabel: `${type} Reminder`,
    });
}

/**
 * Fired by reminderService.js's scheduled job for the "submitted but no
 * longer complete" achievement case — a SUBMITTED MonthlyAchievement
 * exists, but plan item(s) appended later via "Add More Plans" still have
 * no matching progress (see utils/achievementCompleteness.js). Unlike
 * notifyDeadlineReminder above, this is never fired for a plan with no
 * submission at all — reminderService.js routes that case through
 * notifyDeadlineReminder instead, since the messaging genuinely differs
 * (nothing submitted yet vs. some new items still missing progress).
 */
async function notifyIncompleteAchievementReminder({ employee, period, deadlineLabel, daysRemaining, missingCount }) {
    if (!employee?.email) {
        console.warn(`[notification] No email on file — skipped incomplete-progress reminder for employee ${employee?.id}`);
        return { success: false, error: "Employee email missing" };
    }

    const urgency =
        daysRemaining <= 0 ? "today" : daysRemaining === 1 ? "tomorrow" : `in ${daysRemaining} days`;

    return sendMail({
        to: employee.email,
        subject: `Reminder: Progress Missing for ${missingCount} New Item${missingCount !== 1 ? "s" : ""} — Monthly Achievement (${period}) — due ${urgency}`,
        html: incompleteAchievementReminderTemplate({
            employeeName: employee.name,
            period,
            deadlineLabel,
            daysRemaining,
            missingCount,
        }),
        logLabel: "Monthly Achievement Incomplete-Progress Reminder",
    });
}

module.exports = { notifySubmission, notifyAddition, notifyEvaluation, notifyRejection, notifyDeadlineExtension, notifyDeadlineReminder, notifyIncompleteAchievementReminder };