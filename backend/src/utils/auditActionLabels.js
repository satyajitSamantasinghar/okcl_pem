'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  AUDIT ACTION LABELS
//
//  Single source of truth for turning an AuditLog row's raw (entityType,
//  action) pair into a human-readable description — used by both the JSON
//  API and the PDF export of the admin "Employee Activity Log" report, so
//  the two renderings can never describe the same action differently.
//
//  The action/entityType combinations below are taken directly from the
//  AuditLog.create() call sites that currently exist in employeeController.js
//  (DRAFT_SAVE / DRAFT_UPDATE / SUBMIT / RESUBMIT / ADD_PLAN_ITEMS /
//  ADD_ACHIEVEMENT_ITEMS across MONTHLY_PLAN, MONTHLY_ACHIEVEMENT,
//  YEARLY_PLAN, and YEARLY_APPRAISAL_REPORT). No new AuditLog.create() calls
//  were needed for this report — those write points already existed.
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_TYPE_LABELS = {
    MONTHLY_PLAN: 'Monthly Plan',
    MONTHLY_ACHIEVEMENT: 'Monthly Progress',
    YEARLY_PLAN: 'Yearly Plan',
    YEARLY_APPRAISAL_REPORT: 'Yearly Appraisal Report',
};

const ACTION_LABELS = {
    'MONTHLY_PLAN:DRAFT_SAVE': 'Saved Monthly Plan as Draft',
    'MONTHLY_PLAN:DRAFT_UPDATE': 'Updated Monthly Plan Draft',
    'MONTHLY_PLAN:SUBMIT': 'Submitted Monthly Plan',
    'MONTHLY_PLAN:RESUBMIT': 'Resubmitted Monthly Plan',
    'MONTHLY_PLAN:ADD_PLAN_ITEMS': 'Added Plan Item(s) ("Add More Plans")',

    'MONTHLY_ACHIEVEMENT:DRAFT_SAVE': 'Saved Progress as Draft',
    'MONTHLY_ACHIEVEMENT:DRAFT_UPDATE': 'Updated Progress Draft',
    'MONTHLY_ACHIEVEMENT:SUBMIT': 'Submitted Progress',
    'MONTHLY_ACHIEVEMENT:ADD_ACHIEVEMENT_ITEMS': 'Added Progress Item(s) ("Add More Progress")',
    'MONTHLY_ACHIEVEMENT:EDIT_ACHIEVEMENT_ITEMS': 'Edited Progress Item(s)',

    'YEARLY_PLAN:DRAFT_SAVE': 'Saved Yearly Plan as Draft',
    'YEARLY_PLAN:DRAFT_UPDATE': 'Updated Yearly Plan Draft',
    'YEARLY_PLAN:SUBMIT': 'Submitted Yearly Plan',
    'YEARLY_PLAN:RESUBMIT': 'Resubmitted Yearly Plan',

    'YEARLY_APPRAISAL_REPORT:DRAFT_SAVE': 'Saved Appraisal Report as Draft',
    'YEARLY_APPRAISAL_REPORT:DRAFT_UPDATE': 'Updated Appraisal Report Draft',
    'YEARLY_APPRAISAL_REPORT:SUBMIT': 'Submitted Appraisal Report',
};

// The entityTypes this report tracks by default — deliberately limited to
// records an EMPLOYEE writes about their OWN work. AuditLog also carries
// supervisory/administrative actions (RA's EVALUATE / RA_REJECT /
// EXTEND_DEADLINE, admin's ACTIVATE_USER / DEACTIVATE_USER, RA's
// QUARTERLY_EVALUATION GENERATE) logged elsewhere in the codebase — those
// are actions taken ON an employee's record, not BY the employee, and are
// intentionally excluded here so "employee activity" doesn't quietly widen
// into "everything that touched this employee's records."
const EMPLOYEE_ACTIVITY_ENTITY_TYPES = [
    'MONTHLY_PLAN',
    'MONTHLY_ACHIEVEMENT',
    'YEARLY_PLAN',
    'YEARLY_APPRAISAL_REPORT',
];

function describeAuditAction(entityType, action) {
    return (
        ACTION_LABELS[`${entityType}:${action}`] ||
        `${action} — ${ENTITY_TYPE_LABELS[entityType] || entityType}`
    );
}

function entityTypeLabel(entityType) {
    return ENTITY_TYPE_LABELS[entityType] || entityType;
}

module.exports = {
    describeAuditAction,
    entityTypeLabel,
    ENTITY_TYPE_LABELS,
    EMPLOYEE_ACTIVITY_ENTITY_TYPES,
};