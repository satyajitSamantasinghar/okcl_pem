'use strict';

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseTemplate({ title, bodyHtml, ctaText, ctaUrl }) {
  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#0b2545;padding:20px 32px;">
              <span style="color:#ffffff;font-size:18px;font-weight:bold;">KRMS — Performance Evaluation System</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="color:#0b2545;margin-top:0;">${escapeHtml(title)}</h2>
              <div style="color:#333333;font-size:14px;line-height:1.6;">${bodyHtml}</div>
              ${ctaUrl ? `
              <div style="margin-top:24px;">
                <a href="${ctaUrl}" style="background:#f97316;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold;display:inline-block;">${escapeHtml(ctaText || 'View in KRMS')}</a>
              </div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#f4f5f7;padding:16px 32px;font-size:12px;color:#888888;">
              This is an automated notification from KRMS. Please do not reply to this email.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}

function submissionTemplate({ employeeName, raName, period, type }) {
  return baseTemplate({
    title: `${type} Submitted for Review`,
    bodyHtml: `
      <p>Hi ${escapeHtml(raName)},</p>
      <p><strong>${escapeHtml(employeeName)}</strong> has submitted their <strong>${escapeHtml(type)}</strong> for <strong>${escapeHtml(period)}</strong>.</p>
      <p>Please log in to KRMS to review and take action.</p>
    `,
    ctaText: 'Review Now',
    ctaUrl: `${process.env.FRONTEND_URL}/ra/monthly-evaluation`,
  });
}
// Fired when an employee appends new items to an ALREADY-SUBMITTED Monthly
// Plan/Achievement ("Add More Plans" mid-cycle flow). Deliberately a separate
// template from submissionTemplate: the plan/achievement itself was already
// submitted and already triggered that email once — this is a follow-up
// notice about newly appended items only, and should read that way to the RA
// instead of implying a fresh, first-time submission.
function additionalItemsTemplate({ employeeName, raName, period, type, itemCount }) {
  const itemWord = itemCount === 1 ? "item" : "items";
  return baseTemplate({
    title: `New Items Added to a Submitted ${type}`,
    bodyHtml: `
      <p>Hi ${escapeHtml(raName)},</p>
      <p><strong>${escapeHtml(employeeName)}</strong> has added <strong>${itemCount} new ${itemWord}</strong> to their already-submitted <strong>${escapeHtml(type)}</strong> for <strong>${escapeHtml(period)}</strong>.</p>
      <p>The original submission is unchanged — please log in to KRMS to review the newly added ${itemWord}.</p>
    `,
    ctaText: "Review Now",
    ctaUrl: `${process.env.FRONTEND_URL}/ra/monthly-evaluation`,
  });
}

function evaluationTemplate({ employeeName, raName, period, type, remarks }) {
  return baseTemplate({
    title: `Your ${type} Has Been Evaluated`,
    bodyHtml: `
      <p>Hi ${escapeHtml(employeeName)},</p>
      <p>Your <strong>${escapeHtml(type)}</strong> for <strong>${escapeHtml(period)}</strong> has been evaluated by your Reporting Authority, <strong>${escapeHtml(raName)}</strong>.</p>
      ${remarks ? `<p><em>Remarks: ${escapeHtml(remarks)}</em></p>` : ""}
    `,
    ctaText: "View Details",
    ctaUrl: `${process.env.FRONTEND_URL}/employee/monthly-plan`,
  });
}

function rejectionTemplate({ employeeName, raName, period, type, remarks }) {
  return baseTemplate({
    title: `Your ${type} Was Rejected`,
    bodyHtml: `
      <p>Hi ${escapeHtml(employeeName)},</p>
      <p>Your <strong>${escapeHtml(type)}</strong> for <strong>${escapeHtml(period)}</strong> has been <strong>rejected</strong> by your Reporting Authority, <strong>${escapeHtml(raName)}</strong>.</p>
      <p><em>Reason: ${escapeHtml(remarks)}</em></p>
      <p>Please revise and resubmit at your earliest convenience.</p>
    `,
    ctaText: "Revise & Resubmit",
    ctaUrl: `${process.env.FRONTEND_URL}/employee/monthly-plan`,
  });
}

// Fired by reminderService.js's scheduled job when an employee/RA has NOT
// yet submitted their Monthly Plan or Achievement and the effective deadline
// (including any RA-granted extension) is within a configured number of
// days. `type` is the human label passed through from reminderService.js —
// "Monthly Plan" or "Monthly Achievement" — matching the label style already
// used by submissionTemplate/evaluationTemplate above.
function reminderTemplate({ employeeName, type, period, deadlineLabel, daysRemaining }) {
  const urgency =
    daysRemaining <= 0 ? "today" : daysRemaining === 1 ? "tomorrow" : `in ${daysRemaining} days`;

  return baseTemplate({
    title: `Reminder: ${type} for ${period} is due ${urgency}`,
    bodyHtml: `
      <p>Hi ${escapeHtml(employeeName)},</p>
      <p>Our records show you have not yet submitted your <strong>${escapeHtml(type)}</strong> for <strong>${escapeHtml(period)}</strong>.</p>
      <p>The deadline is <strong>${escapeHtml(deadlineLabel)}</strong> (${escapeHtml(urgency)}).</p>
      <p>Please log in to KRMS and submit at your earliest convenience to avoid missing the deadline.</p>
    `,
    ctaText: "Submit Now",
    ctaUrl: `${process.env.FRONTEND_URL}/employee/monthly-plan`,
  });
}

// Fired by reminderService.js's scheduled job for the OTHER achievement-
// reminder case: the employee already has a SUBMITTED Monthly Achievement,
// but it no longer covers every current Monthly Plan item because plan
// item(s) were appended later via "Add More Plans" and matching progress
// was never separately submitted for them via "Add More Progress" (the
// achievement's `status` stays "SUBMITTED" from the earlier, smaller
// submission — see utils/achievementCompleteness.js's isAchievementCompleteForPlan
// for the full rationale). Deliberately a separate template from
// reminderTemplate: telling someone who already submitted most of their
// progress "you have not yet submitted" would be inaccurate and confusing —
// this instead names exactly what's missing (new item(s) without progress)
// and what happens if the deadline passes without it: the RA cannot
// evaluate the record, per raController.js's isAchievementCompleteForPlan
// evaluate-authorization guard.
function incompleteAchievementReminderTemplate({ employeeName, period, deadlineLabel, daysRemaining, missingCount }) {
  const urgency =
    daysRemaining <= 0 ? "today" : daysRemaining === 1 ? "tomorrow" : `in ${daysRemaining} days`;
  const itemWord = missingCount === 1 ? "item" : "items";
  const missingVerb = missingCount === 1 ? "doesn't" : "don't";
  const beVerb = missingCount === 1 ? "isn't" : "aren't";

  return baseTemplate({
    title: `Reminder: Progress Missing for ${missingCount} New Plan ${itemWord} — ${period}`,
    bodyHtml: `
      <p>Hi ${escapeHtml(employeeName)},</p>
      <p>You've already submitted progress for your <strong>Monthly Achievement</strong> for <strong>${escapeHtml(period)}</strong>, but <strong>${missingCount} new plan ${itemWord}</strong> added afterward (via "Add More Plans") still ${missingVerb} have progress reported.</p>
      <p>The deadline to add progress is <strong>${escapeHtml(deadlineLabel)}</strong> (${escapeHtml(urgency)}). If progress for ${missingCount === 1 ? "this item" : "these items"} ${beVerb} submitted by then, your Reporting Authority will <strong>not be able to evaluate</strong> this month's record.</p>
      <p>Please log in to KRMS and add progress for the new ${itemWord} at your earliest convenience.</p>
    `,
    ctaText: "Add Progress Now",
    ctaUrl: `${process.env.FRONTEND_URL}/employee/monthly-plan`,
  });
}

function deadlineExtensionTemplate({ employeeName, raName, type, period, newDeadline, reason }) {
  return baseTemplate({
    title: `${type} Deadline Extended`,
    bodyHtml: `
      <p>Hi ${escapeHtml(employeeName)},</p>
      <p>Your Reporting Authority, <strong>${escapeHtml(raName)}</strong>, has extended your <strong>${escapeHtml(type)}</strong> submission deadline for <strong>${escapeHtml(period)}</strong> to <strong>${escapeHtml(newDeadline)}</strong>.</p>
      <p><em>Reason: ${escapeHtml(reason)}</em></p>
    `,
    ctaText: "View in KRMS",
    ctaUrl: `${process.env.FRONTEND_URL}/employee`,
  });
}


module.exports = { baseTemplate, submissionTemplate, additionalItemsTemplate, evaluationTemplate, rejectionTemplate, reminderTemplate, incompleteAchievementReminderTemplate, deadlineExtensionTemplate };