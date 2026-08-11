'use strict';

const { sendMail } = require('./email');
const { submissionTemplate, evaluationTemplate, rejectionTemplate, deadlineExtensionTemplate } = require("./emailTemplates");
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

module.exports = { notifySubmission, notifyEvaluation, notifyRejection, notifyDeadlineExtension };