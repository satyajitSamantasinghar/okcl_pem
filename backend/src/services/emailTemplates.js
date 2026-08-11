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


module.exports = { baseTemplate, submissionTemplate, evaluationTemplate, rejectionTemplate, deadlineExtensionTemplate };