'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN CONTROLLER
//
//  Six handlers:
//    1. getDashboardSummary   — org-wide + per-dept counts (month-scoped)
//    2. getEmployeeList       — paginated, filterable, sortable employee list
//       (month-scoped; also filterable by active/inactive status)
//    3. exportComplianceReportPdf — streams a PDF compliance report, grouped
//       by department (default) or by Reporting Authority (?groupBy=ra)
//       (month-scoped)
//    4. updateEmployeeStatus  — PATCH: flips a user's isActive flag. This is
//       the "mark an employee who has left the company as inactive" control.
//       Not month-scoped — isActive is a point-in-time flag on the user, not
//       a per-month fact.
//    5. getActivityLogReport  — paginated, filterable list of an employee's
//       OWN AuditLog entries for the month (draft saves, submits, resubmits,
//       "Add More" appends — see utils/auditActionLabels.js for the exact
//       action set). Does NOT write any new AuditLog rows; it only reads
//       ones employeeController.js already writes on every relevant action.
//    6. exportActivityLogReportPdf — streams a PDF of the same data, grouped
//       by department (default) or by Reporting Authority (?groupBy=ra),
//       one employee per card, chronological entries underneath.
//
//  Handlers 1–3 share a single helper (fetchMonthlyComplianceData) that
//  does the heavy DB lifting once per request — no N+1 per-employee loops.
//  Handlers 5–6 share fetchEmployeeActivityData, which reuses
//  fetchMonthlyComplianceData purely for its employee roster (department,
//  role, active-during-month status) rather than re-deriving that logic.
//
//  Completeness definition is always delegated to isAchievementCompleteForPlan
//  (the single shared implementation) — never re-derived inline.
//
//  The RA-grouped views (export #3 and #6) resolve "which RA is this
//  employee mapped to this month" via EmployeeRAHistory (date-overlap), NOT
//  the live User.reportingAuthorityId snapshot — see
//  fetchEmployeeIdsByRAForMonth for why. This mirrors raController.js's
//  getRADashboard query; if that ever gets extracted into a shared util,
//  point this at it instead of hand-keeping two copies in sync.
// ─────────────────────────────────────────────────────────────────────────────

const { Op, QueryTypes } = require('sequelize');
const {
  sequelize,
  User,
  MonthlyPlan,
  MonthlyPlanItem,
  MonthlyAchievement,
  MonthlyAchievementItem,
  EmployeeRAHistory,
  AuditLog,
  UserStatusHistory,
} = require('../models');

const { isAchievementCompleteForPlan } = require('../utils/achievementCompleteness');
const { filterActiveDuringMonth } = require('../utils/userStatusHistory');
const {
  describeAuditAction,
  entityTypeLabel,
  EMPLOYEE_ACTIVITY_ENTITY_TYPES,
} = require('../utils/auditActionLabels');

/* ─── Validation helper ────────────────────────────────────────────────────── */
function validateMonth(month) {
  return month && /^\d{4}-\d{2}$/.test(month);
}

/* ─── Which roles the admin views track as "employees who must submit" ──────
   Single source of truth — every query in this file reads from here instead
   of hardcoding the role list, so admin/dashboard/PDF can't silently drift
   out of sync with each other the way department-filter logic once did. ──── */
const ADMIN_TRACKED_ROLES = ['EMPLOYEE', 'RA'];

/* ─────────────────────────────────────────────────────────────────────────────
   SHARED DATA HELPER
   ─────────────────────────────────────────────────────────────────────────────
   Returns an array of enriched employee objects for the given month.
   Runs a small fixed set of aggregate queries instead of one loop per employee.

   `activeFilter` controls which users are included:
     'active'   (default) — was active (isActive: true) at ANY point DURING
                 the requested `month`, per UserStatusHistory (NOT the live
                 User.isActive snapshot). Used by getDashboardSummary and
                 exportComplianceReportPdf. This is deliberately month-aware:
                 an employee deactivated in September must still appear in
                 August's dashboard/PDF, because they were on staff for
                 August — only months after their deactivation should stop
                 counting them. (Fixed Sep 2026 — previously used the live
                 isActive column, which made a deactivation retroactively
                 erase the employee from every past month's reports too.)
     'inactive' — isActive: false on the LIVE User row (current snapshot,
                 deliberately NOT month-aware). This is getEmployeeList's
                 administrative "who do I need to review/reactivate right
                 now" view, not a historical fact about `month` — so it
                 intentionally keeps the old semantics.
     'all'      — no isActive condition at all (unchanged).

   Each entry shape:
   {
     id, name, employeeCode, department, email, role, isActive,
     planStatus: null | 'SUBMITTED' | 'APPROVED' | ... (plan.status)
     planId: null | uuid,
     planSubmittedAt: null | Date,
     achievementStatus: 'NOT_STARTED' | 'INCOMPLETE' | 'COMPLETE',
     achievementSubmittedAt: null | Date,
   }

   "COMPLETE" means a SUBMITTED achievement whose item count covers every
   current plan item (per isAchievementCompleteForPlan).
   "INCOMPLETE" means a SUBMITTED achievement that doesn't cover them all.
   "NOT_STARTED" means no SUBMITTED achievement at all.
────────────────────────────────────────────────────────────────────────────── */
async function fetchMonthlyComplianceData(month, activeFilter = 'active') {
  // ── 1. EMPLOYEE + RA users (not HRD/MD/ADMIN), scoped by activeFilter ──────
  //       RAs carry their own monthly plan/achievement obligations just like
  //       employees do, so they're counted here too. If you later want the
  //       admin org-wide view to also cover HRD/MD, extend ADMIN_TRACKED_ROLES.
  const where = { role: { [Op.in]: ADMIN_TRACKED_ROLES } };
  // 'active' is intentionally NOT applied as a live isActive condition here
  // — it's resolved below via UserStatusHistory instead, because it needs to
  // be month-aware. 'inactive' stays a live-snapshot condition on purpose
  // (see the comment above). 'all' applies no condition either way.
  if (activeFilter === 'inactive') where.isActive = false;

  const employees = await User.findAll({
    where,
    attributes: ['id', 'name', 'employeeCode', 'department', 'email', 'role', 'isActive'],
    order: [['name', 'ASC']],
  });

  if (employees.length === 0) return [];

  // 'active' (default): narrow down to employees who were active at some
  // point DURING `month`, per UserStatusHistory — not who happens to be
  // active right now. See filterActiveDuringMonth's own header for the
  // overlap condition this applies.
  let scopedEmployees = employees;
  if (activeFilter === 'active') {
    const activeIdSet = new Set(
      await filterActiveDuringMonth(employees.map(e => e.id), month)
    );
    scopedEmployees = employees.filter(e => activeIdSet.has(e.id));
    if (scopedEmployees.length === 0) return [];
  }

  const employeeIds = scopedEmployees.map(e => e.id);

  // ── 2. Non-DRAFT, non-REJECTED plans for this month ───────────────────────
  const plans = await MonthlyPlan.findAll({
    where: {
      employeeId: { [Op.in]: employeeIds },
      month,
      status: { [Op.notIn]: ['DRAFT', 'REJECTED'] },
    },
    attributes: ['id', 'employeeId', 'status', 'submittedAt'],
  });

  const planByEmployee = new Map(); // employeeId → plan
  const planIds = [];
  for (const p of plans) {
    planByEmployee.set(p.employeeId, p);
    planIds.push(p.id);
  }

  // ── 3. Plan item counts per plan ──────────────────────────────────────────
  //       One aggregate query replaces N individual counts.
  const planItemRows = planIds.length > 0
    ? await MonthlyPlanItem.findAll({
      where: { monthlyPlanId: { [Op.in]: planIds } },
      attributes: [
        'monthlyPlanId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'cnt'],
      ],
      group: ['monthlyPlanId'],
      raw: true,
    })
    : [];

  const planItemCountByPlan = new Map();
  for (const r of planItemRows) {
    planItemCountByPlan.set(r.monthlyPlanId, Number(r.cnt));
  }

  // ── 4. SUBMITTED achievements for those plans ─────────────────────────────
  const achievements = planIds.length > 0
    ? await MonthlyAchievement.findAll({
      where: {
        monthlyPlanId: { [Op.in]: planIds },
        status: 'SUBMITTED',
      },
      attributes: ['id', 'monthlyPlanId', 'submittedAt'],
    })
    : [];

  const achByPlan = new Map(); // planId → achievement
  const achIds = [];
  for (const a of achievements) {
    achByPlan.set(a.monthlyPlanId, a);
    achIds.push(a.id);
  }

  // ── 5. Achievement item counts per achievement ────────────────────────────
  const achItemRows = achIds.length > 0
    ? await MonthlyAchievementItem.findAll({
      where: { monthlyAchievementId: { [Op.in]: achIds } },
      attributes: [
        'monthlyAchievementId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'cnt'],
      ],
      group: ['monthlyAchievementId'],
      raw: true,
    })
    : [];

  const achItemCountByAch = new Map();
  for (const r of achItemRows) {
    achItemCountByAch.set(r.monthlyAchievementId, Number(r.cnt));
  }

  // ── 6. Merge into enriched employee rows ─────────────────────────────────
  return scopedEmployees.map(emp => {
    const plan = planByEmployee.get(emp.id) || null;

    let achievementStatus = 'NOT_STARTED';
    let achievementSubmittedAt = null;

    if (plan) {
      const ach = achByPlan.get(plan.id) || null;
      if (ach) {
        achievementSubmittedAt = ach.submittedAt;
        const planItemCount = planItemCountByPlan.get(plan.id) ?? 0;
        const achItemCount = achItemCountByAch.get(ach.id) ?? 0;
        achievementStatus = isAchievementCompleteForPlan(planItemCount, achItemCount)
          ? 'COMPLETE'
          : 'INCOMPLETE';
      }
    }

    return {
      id: emp.id,
      name: emp.name,
      employeeCode: emp.employeeCode,
      department: emp.department || 'Unassigned',
      email: emp.email,
      role: emp.role,
      isActive: emp.isActive,
      planStatus: plan ? plan.status : null,
      planId: plan ? plan.id : null,
      planSubmittedAt: plan ? plan.submittedAt : null,
      achievementStatus,
      achievementSubmittedAt,
    };
  });
}

/* ─── RA assignment lookup, for the "By Reporting Authority" export format ──
   Returns Map<raId, Set<employeeId>> — who was mapped to which RA at any
   point during the given month.

   Deliberately queries EmployeeRAHistory with a date-overlap check instead
   of the live User.reportingAuthorityId column. reportingAuthorityId is only
   today's snapshot; an employee reassigned from RA A to RA B mid-year would
   be silently attributed to RA B even when reporting a past month, which is
   exactly wrong for a compliance report. This is the same overlap condition
   raController.js's getRADashboard uses (effectiveFrom before month-end AND
   (still active OR was active at some point in the month)) — kept identical
   on purpose so the admin's "By RA" export can never disagree with what an
   RA sees on their own dashboard for the same month.

   Note: if an employee's assignment genuinely changed mid-month (row for RA A
   ending mid-month, row for RA B starting mid-month), both rows can overlap
   the same month and the employee will legitimately appear under both RAs —
   matching the per-RA dashboard's own behavior, not a bug introduced here. ──
*/
async function fetchEmployeeIdsByRAForMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  const startOfMonth = new Date(year, mon - 1, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(year, mon, 0, 23, 59, 59, 999);

  const historyRows = await EmployeeRAHistory.findAll({
    where: {
      effectiveFrom: { [Op.lte]: endOfMonth },
      [Op.or]: [
        { effectiveTo: null },
        { effectiveTo: { [Op.gte]: startOfMonth } },
      ],
    },
    attributes: ['raId', 'employeeId'],
  });

  const employeeIdsByRA = new Map();
  for (const h of historyRows) {
    if (!employeeIdsByRA.has(h.raId)) employeeIdsByRA.set(h.raId, new Set());
    employeeIdsByRA.get(h.raId).add(h.employeeId);
  }
  return employeeIdsByRA;
}

/* ─── Group a list of compliance rows by Reporting Authority ────────────────
   Mirrors groupByDept's shape ([label, rows[]] pairs) so both grouping modes
   render through the exact same PDF-drawing loop below. Called ONCE, on the
   full month's row set (Completed and Non-Completed together) — the PDF
   render loop is what later renders each group's rows as a single ranked
   table, so every RA appears exactly once here. Each RA's own compliance row
   (they carry the same plan/progress obligations as an employee — see
   ADMIN_TRACKED_ROLES) is prepended to their own group so it isn't just
   implied by the group header — it's an actual row a reader can check,
   styled distinctly by employeeRow(). Regular employees with no RA match for
   the month land in an "Unassigned RA" bucket, same reasoning as the
   department view's "Unassigned" department bucket.

   A superior/subordinate RA hierarchy is resolved in two passes so a
   subordinate RA (e.g. Piyush, who himself reports to Jayesh) is placed
   correctly regardless of which name sorts first alphabetically:
     Pass 1 — for every RA, resolve their direct reports against rows of ANY
       tracked role (not just 'EMPLOYEE' — a subordinate RA's own compliance
       row has role 'RA' too, and matching only 'EMPLOYEE' rows meant a
       subordinate RA could never be matched into a superior's group; they
       could only ever be their own top-level group). This is tracked
       independently of iteration order via `claimedIds`.
     Pass 2 — build each RA's card. A subordinate RA's own self-row is
       included only if they weren't already claimed as someone else's
       direct report in pass 1 — otherwise their personal status would be
       shown twice (once nested under their superior, once again as their
       own top-level row). Their own group still exists whenever they have
       direct reports of their own; it just won't duplicate their personal
       row. This generalizes to any depth of hierarchy, not just one level.
*/
function groupByRA(list, employeeIdsByRA, raById) {
  const raSelfRows = list.filter(r => r.role === 'RA'); // RA's own compliance row, if in this list

  const raIdsWithReports = [...employeeIdsByRA.keys()].filter(raId => raById.has(raId));
  const raIdsWithSelfRow = raSelfRows.map(r => r.id);
  const allRaIds = [...new Set([...raIdsWithReports, ...raIdsWithSelfRow])]
    .sort((a, b) => raById.get(a).name.localeCompare(raById.get(b).name));

  // Pass 1: resolve each RA's direct reports against the full row set (any
  // role), and track which ids land inside a superior's group.
  const reportsByRA = new Map();
  const claimedIds = new Set();
  for (const raId of allRaIds) {
    const empIds = employeeIdsByRA.get(raId) || new Set();
    const matched = list.filter(r => r.id !== raId && empIds.has(r.id));
    reportsByRA.set(raId, matched);
    matched.forEach(r => claimedIds.add(r.id));
  }

  // Pass 2: build each RA's card, skipping a subordinate RA's own self-row
  // wherever it's already claimed by a superior's group.
  const groups = [];
  for (const raId of allRaIds) {
    const ra = raById.get(raId);
    const matchedReports = reportsByRA.get(raId);
    const raSelfRow = raSelfRows.find(r => r.id === raId) || null;
    const includeSelfRow = !!raSelfRow && !claimedIds.has(raId);

    if (matchedReports.length === 0 && !includeSelfRow) continue; // nothing to show for this RA in this subset

    const tableRows = includeSelfRow ? [raSelfRow, ...matchedReports] : matchedReports;
    groups.push([`${ra.name}  (${ra.employeeCode})`, tableRows]);
  }

  const employeeRows = list.filter(r => r.role === 'EMPLOYEE');
  const unassigned = employeeRows.filter(r => !claimedIds.has(r.id));
  if (unassigned.length > 0) {
    groups.push(['Unassigned RA', unassigned]);
  }
  return groups;
}

/* ─── 1. GET /api/admin/dashboard-summary ────────────────────────────────── */
exports.getDashboardSummary = async (req, res) => {
  try {
    const { month } = req.query;
    if (!validateMonth(month)) {
      return res.status(400).json({ message: 'month query param is required (YYYY-MM)' });
    }

    const rows = await fetchMonthlyComplianceData(month);

    // Org-wide counts
    const totalEmployees = rows.length;
    const planSubmitted = rows.filter(r => r.planId !== null).length;
    const noPlan = rows.filter(r => r.planId === null).length;

    // "achievement submitted" = has a SUBMITTED achievement (any completeness)
    const achievementSubmitted = rows.filter(r =>
      r.achievementStatus === 'COMPLETE' || r.achievementStatus === 'INCOMPLETE'
    ).length;

    // "plan only / missing or incomplete achievement"
    // = has a plan BUT achievement is NOT_STARTED or INCOMPLETE
    const planOnlyOrIncomplete = rows.filter(r =>
      r.planId !== null &&
      (r.achievementStatus === 'NOT_STARTED' || r.achievementStatus === 'INCOMPLETE')
    ).length;

    // Per-department breakdown
    const deptMap = new Map();
    for (const r of rows) {
      const dept = r.department;
      if (!deptMap.has(dept)) {
        deptMap.set(dept, {
          department: dept,
          totalEmployees: 0,
          planSubmitted: 0,
          achievementSubmitted: 0,
          noPlan: 0,
          planOnlyOrIncomplete: 0,
        });
      }
      const d = deptMap.get(dept);
      d.totalEmployees++;
      if (r.planId !== null) d.planSubmitted++;
      if (r.achievementStatus === 'COMPLETE' || r.achievementStatus === 'INCOMPLETE') d.achievementSubmitted++;
      if (r.planId === null) d.noPlan++;
      if (r.planId !== null &&
        (r.achievementStatus === 'NOT_STARTED' || r.achievementStatus === 'INCOMPLETE')) {
        d.planOnlyOrIncomplete++;
      }
    }

    const byDepartment = [...deptMap.values()].sort((a, b) =>
      a.department.localeCompare(b.department)
    );

    // Separate, lightweight count of deactivated tracked-role users — org-
    // health context for the admin, kept OUT of the metrics above (which
    // intentionally stay scoped to active staff only, so compliance numbers
    // never shift just because someone left the company this month).
    const inactiveEmployees = await User.count({
      where: { role: { [Op.in]: ADMIN_TRACKED_ROLES }, isActive: false },
    });

    return res.json({
      month,
      totalEmployees,
      planSubmitted,
      achievementSubmitted,
      noPlan,
      planOnlyOrIncomplete,
      inactiveEmployees,
      byDepartment,
    });
  } catch (err) {
    console.error('[adminController] getDashboardSummary error:', err);
    return res.status(500).json({ message: 'Failed to load dashboard summary', error: err.message });
  }
};

/* ─── 2. GET /api/admin/employees ────────────────────────────────────────── */
exports.getEmployeeList = async (req, res) => {
  try {
    const { month, department, status, search, sort = 'name', order = 'asc' } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    if (!validateMonth(month)) {
      return res.status(400).json({ message: 'month query param is required (YYYY-MM)' });
    }

    // Validate status filter
    const VALID_STATUS = ['NOT_SUBMITTED', 'PLAN_ONLY', 'COMPLETE'];
    if (status && !VALID_STATUS.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${VALID_STATUS.join(', ')}` });
    }

    // Active/inactive filter — defaults to 'active' so a deactivated employee
    // (left the company) doesn't clutter the default view; pass ?activeStatus=
    // inactive or =all to review/reactivate one.
    const VALID_ACTIVE_STATUS = ['active', 'inactive', 'all'];
    const activeStatus = VALID_ACTIVE_STATUS.includes(req.query.activeStatus)
      ? req.query.activeStatus
      : 'active';

    // ── Single shared data source ──────────────────────────────────────────
    // Same enrichment logic the dashboard summary and PDF export use, so the
    // three views can never disagree on who counts, what "compliant" means,
    // or which roles are tracked. At current org sizes (tens of employees,
    // not thousands) filtering/sorting/paginating in JS over this array is
    // negligible cost and removes ~100 lines that used to duplicate the plan/
    // achievement queries above almost verbatim. If the org ever grows large
    // enough for that to matter, push department/search/status back down into
    // the initial User/MonthlyPlan queries — but keep them reading from the
    // same role list and completeness helper this file already centralizes.
    let rows = await fetchMonthlyComplianceData(month, activeStatus);

    // ── Derive complianceStatus (this endpoint's own filter vocabulary —
    //    dashboard summary and PDF export partition compliant/non-compliant
    //    directly instead of needing this three-way status) ─────────────────
    rows = rows.map(r => ({
      ...r,
      complianceStatus: !r.planId
        ? 'NOT_SUBMITTED'
        : r.achievementStatus === 'COMPLETE'
          ? 'COMPLETE'
          : 'PLAN_ONLY',
    }));

    // ── Filters ───────────────────────────────────────────────────────────
    // department/email department normalization ("Unassigned" for null/'')
    // already happened once, inside fetchMonthlyComplianceData — filtering
    // on the normalized value here means there's only one place that can
    // ever get that bucketing wrong, instead of two.
    if (department) {
      rows = rows.filter(r => r.department === department);
    }
    if (status) {
      rows = rows.filter(r => r.complianceStatus === status);
    }
    if (search) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.employeeCode || '').toLowerCase().includes(q)
      );
    }

    // ── Sort ──────────────────────────────────────────────────────────────
    const sortDir = order === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      switch (sort) {
        case 'department': return sortDir * a.department.localeCompare(b.department);
        case 'employeeCode': return sortDir * (a.employeeCode || '').localeCompare(b.employeeCode || '');
        case 'planSubmittedAt': {
          const aD = a.planSubmittedAt ? new Date(a.planSubmittedAt).getTime() : 0;
          const bD = b.planSubmittedAt ? new Date(b.planSubmittedAt).getTime() : 0;
          return sortDir * (aD - bD);
        }
        case 'complianceStatus': return sortDir * a.complianceStatus.localeCompare(b.complianceStatus);
        case 'name':
        default:
          return sortDir * (a.name || '').localeCompare(b.name || '');
      }
    });

    // ── Paginate ──────────────────────────────────────────────────────────
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageRows = rows.slice((page - 1) * limit, page * limit);

    return res.json({ page, limit, total, totalPages, data: pageRows });
  } catch (err) {
    console.error('[adminController] getEmployeeList error:', err);
    return res.status(500).json({ message: 'Failed to load employee list', error: err.message });
  }
};

/* ─── 3. PATCH /api/admin/employees/:id/status ──────────────────────────────
   Flips a user's isActive flag — the mechanism for marking an employee/RA who
   has left the company as inactive (or reversing that: a rehire, or undoing
   a mistaken deactivation).

   Deliberately scoped OUT of ADMIN accounts: this endpoint can never be used
   to deactivate the only admin account, another admin, or (by extension)
   itself — that kind of account-lifecycle change belongs to a deliberate,
   out-of-band action, not a single API call reachable from the employee
   table.

   Every change is written to AuditLog, the same convention every other
   write action in this codebase follows (see hrdController.js's
   assignEmployeesToRA, raController.js's rejectMonthlyPlan).

   Also writes a UserStatusHistory row on every flip (closes the previously-
   open row, opens a new one) — wrapped in the same transaction as the
   User.isActive save and the AuditLog write, so the three can never end up
   disagreeing with each other if one step fails partway through. This is
   what lets month-scoped views (admin compliance dashboard/PDF, RA
   dashboard, RA deadline management) correctly answer "was this person
   active DURING month M" — see utils/userStatusHistory.js.
────────────────────────────────────────────────────────────────────────────── */
exports.updateEmployeeStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      await t.rollback();
      return res.status(400).json({ message: 'isActive (boolean) is required in the request body' });
    }

    const user = await User.findByPk(id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'ADMIN') {
      await t.rollback();
      return res.status(400).json({ message: 'Admin accounts cannot be activated or deactivated from this endpoint.' });
    }

    if (String(user.id) === String(req.user.userId)) {
      await t.rollback();
      return res.status(400).json({ message: 'You cannot change your own active status.' });
    }

    if (user.isActive === isActive) {
      await t.rollback();
      return res.status(400).json({ message: `${user.name} is already ${isActive ? 'active' : 'inactive'}.` });
    }

    // Deactivating an RA: warn (don't block) if they still have active direct
    // reports pointed at them. Reassignment is HRD's assignEmployeesToRA flow
    // (hrdController.js) — this endpoint's job is only to flip the flag and
    // leave a clean audit trail, not to reshuffle reporting lines itself.
    let warning;
    if (isActive === false && user.role === 'RA') {
      const activeReportCount = await User.count({
        where: { reportingAuthorityId: user.id, isActive: true },
        transaction: t,
      });
      if (activeReportCount > 0) {
        warning = `${user.name} still has ${activeReportCount} active direct report(s). Consider reassigning them via the HRD "Assign Employees to RA" tool.`;
      }
    }

    const changedAt = new Date();

    user.isActive = isActive;
    // Deactivating: also clear the stored refresh token so an already-issued
    // session can't silently mint a new access token via /auth/refresh once
    // the current one expires — see authController.js's refreshAccessToken,
    // which now rejects (and clears) an inactive user's refresh token too.
    // This is belt-and-suspenders: either check alone already closes the
    // gap, but clearing it here means the DB stops carrying a token for a
    // deactivated user at all, rather than relying on it being rejected later.
    if (!isActive) user.refreshToken = null;
    await user.save({ transaction: t });

    // Close the currently-open UserStatusHistory row (if any — the initial
    // backfill row for this user, or a previous transition) and open a new
    // one for the new status. Mirrors exactly how EmployeeRAHistory rows are
    // closed/reopened on RA reassignment.
    await UserStatusHistory.update(
      { effectiveTo: changedAt },
      { where: { userId: user.id, effectiveTo: null }, transaction: t }
    );
    await UserStatusHistory.create(
      {
        userId: user.id,
        isActive,
        effectiveFrom: changedAt,
        effectiveTo: null,
        changedBy: req.user.userId,
      },
      { transaction: t }
    );

    await AuditLog.create({
      userId: req.user.userId,
      action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      entityType: 'USER',
      entityId: String(user.id),
      ipAddress: req.ip,
    }, { transaction: t });

    await t.commit();

    return res.json({
      message: `${user.name} marked ${isActive ? 'active' : 'inactive'} successfully.`,
      employee: {
        id: user.id,
        name: user.name,
        employeeCode: user.employeeCode,
        role: user.role,
        isActive: user.isActive,
      },
      ...(warning && { warning }),
    });
  } catch (err) {
    await t.rollback();
    console.error('[adminController] updateEmployeeStatus error:', err);
    return res.status(500).json({ message: 'Failed to update employee status', error: err.message });
  }
};

/* ─── 4. GET /api/admin/export-pdf ──────────────────────────────────────── */
exports.exportComplianceReportPdf = async (req, res) => {
  try {
    const { month } = req.query;
    if (!validateMonth(month)) {
      return res.status(400).json({ message: 'month query param is required (YYYY-MM)' });
    }

    const groupBy = req.query.groupBy === 'ra' ? 'ra' : 'department';

    const [year, mon] = month.split('-').map(Number);
    const monthLabel = new Date(year, mon - 1, 1).toLocaleString('en-US', {
      month: 'long', year: 'numeric',
    });

    const rows = await fetchMonthlyComplianceData(month);

    // Partition: compliant = plan + complete achievement; non-compliant = everyone else
    const compliant = rows.filter(r => r.achievementStatus === 'COMPLETE');
    const nonCompliant = rows.filter(r => r.achievementStatus !== 'COMPLETE');

    // Group by department (sorted)
    function groupByDept(list) {
      const map = new Map();
      for (const r of list) {
        const dept = r.department;
        if (!map.has(dept)) map.set(dept, []);
        map.get(dept).push(r);
      }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }

    // Group the FULL row set (compliant + non-compliant together) by RA/
    // department, once, so every RA/Department appears exactly once in the
    // report with a single ranked table underneath it — instead of listing
    // an RA/department once under "Completed" and again, separately, under
    // "Non-Completed" (or, in between, as two separate sub-tables nested
    // under one group header).
    let groups, groupLabel;
    if (groupBy === 'ra') {
      const employeeIdsByRA = await fetchEmployeeIdsByRAForMonth(month);
      const raById = new Map(rows.filter(r => r.role === 'RA').map(r => [r.id, r]));
      groups = groupByRA(rows, employeeIdsByRA, raById);
      groupLabel = 'Reporting Authority';
    } else {
      groups = groupByDept(rows);
      groupLabel = 'Department';
    }

    // ── Build PDF ─────────────────────────────────────────────────────────
    const PDFDocument = require('pdfkit');
    // bufferPages: true keeps every generated page in memory instead of
    // flushing it to the response as soon as the next page starts. Without
    // this, doc.bufferedPageRange() below only ever "sees" the single page
    // that hasn't been flushed yet (i.e. the last one) once the document
    // spans more than one page — which is exactly why the exported PDF's
    // footer only ever said "Page 1 of 1" and every page before the last
    // one had no footer at all. This report is small (tens to low hundreds
    // of rows), so holding all pages in memory until doc.end() is cheap.
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="compliance-report-${month}${groupBy === 'ra' ? '-by-ra' : ''}.pdf"`
    );
    doc.pipe(res);

    // ── Colour palette ───────────────────────────────────────────────────
    const PRIMARY = '#185FA5';
    const GREEN = '#3B6D11';
    const RED = '#A32D2D';
    const AMBER = '#BA7517';
    const GREY_DARK = '#1F2937';
    const GREY_MID = '#6B7280';
    const GREY_LITE = '#F3F4F6';
    const WHITE = '#FFFFFF';
    const RA_TINT = '#EEF2FF'; // marks an RA's own row wherever it appears in a table

    // ── Helpers ──────────────────────────────────────────────────────────
    const pageW = doc.page.width - doc.options.margin * 2;
    const left = doc.options.margin;

    // ── Layout constants used by every page-break check below ──────────────
    // Previously each check re-typed its own magic number (40, 80, 120, 170)
    // measured from the raw page edge instead of from the actual bottom
    // margin, and the per-row check didn't account for the row's own height
    // at all. That let the last row on a page start as little as ~1pt above
    // the bottom margin and render up to ~28pt past it — straight through
    // where the footer (added afterwards, below) gets stamped, which is the
    // "overlapping/garbled" page-break glitch. Every check now derives from
    // the same numbers used to actually draw those elements, so they can't
    // drift out of sync again.
    const MARGIN = doc.options.margin;                 // 50
    const ROW_H = 18;                                   // employeeRow() rect height
    const TABLE_HEADER_H = 18;                           // tableHeader() rect height + spacing
    const GROUP_HEADER_H = 30;                           // groupHeader() card band + its spacing
    // A group can't open at the very bottom of a page with nothing under it:
    // reserve room for the group's own header PLUS its table header and
    // >=1 row before starting a new RA/department block.
    const MIN_GROUP_BLOCK = GROUP_HEADER_H + TABLE_HEADER_H + ROW_H;
    const LEGEND_BREAK_BUFFER = 120;                     // == old flat "page.height - 170"
    function pageBottom() { return doc.page.height - MARGIN; } // usable bottom edge

    function hRule(y, color = '#E5E7EB') {
      doc.moveTo(left, y).lineTo(left + pageW, y).strokeColor(color).lineWidth(0.5).stroke();
    }

    function sectionTitle(text, color = PRIMARY) {
      // Fixed, deterministic offsets instead of moveDown() factors. moveDown()
      // scales off whatever font size was last active — right after the 16pt
      // stat numbers above, that made this gap noticeably bigger than the
      // 13pt title it's actually spacing, which read as unintentional
      // dead space between the stat box and the table below.
      doc.y += 4;
      doc.fontSize(13).fillColor(color).font('Helvetica-Bold')
        .text(text, left, doc.y, { width: pageW });
      doc.y += 16; // ~13pt bold title's own line height
      hRule(doc.y, color);
      doc.y += 6;
      doc.x = left; // pdfkit leaves doc.x wherever the text() call above put it — pin it back
    }

    // Group header = one RA/department "card": a shaded band with the
    // group's name on the left and a compact Total/Completed/Pending
    // tally on the right, so a reader can see that RA or department's
    // whole standing at a glance before reading its table below.
    function groupHeader(groupName, total, completedCount, pendingCount) {
      const y = doc.y;
      const boxH = 22;
      doc.rect(left, y, pageW, boxH).fill(GREY_LITE);
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(GREY_DARK)
        .text(groupName, left + 8, y + 6, { width: pageW * 0.5, lineBreak: false });

      doc.fontSize(8).font('Helvetica-Bold');
      doc.fillColor(GREY_MID)
        .text(`${total} Total`, left + pageW * 0.55, y + 7, { width: pageW * 0.15, align: 'right', lineBreak: false });
      doc.fillColor(GREEN)
        .text(`${completedCount} Completed`, left + pageW * 0.68, y + 7, { width: pageW * 0.16, align: 'right', lineBreak: false });
      doc.fillColor(RED)
        .text(`${pendingCount} Pending`, left + pageW * 0.83, y + 7, { width: pageW * 0.17, align: 'right', lineBreak: false });

      doc.x = left;
      doc.y = y + boxH + 8;
    }

    function employeeRow(r, idx) {
      const isRA = r.role === 'RA';
      const bg = isRA ? RA_TINT : (idx % 2 === 0 ? GREY_LITE : WHITE);
      const rowH = 18;
      const rowY = doc.y;

      // Zebra background (RA's own row gets a fixed tint instead, so it stands
      // out regardless of which row position it lands in)
      doc.rect(left, rowY, pageW, rowH).fill(bg);

      doc.fontSize(8).font(isRA ? 'Helvetica-Bold' : 'Helvetica').fillColor(isRA ? PRIMARY : GREY_DARK);
      doc.text((r.name || '—') + (isRA ? '  (RA)' : ''), left + 4, rowY + 4, { width: 170, lineBreak: false });

      doc.font('Helvetica').fillColor(GREY_DARK);
      doc.text(r.employeeCode || '—', left + 180, rowY + 4, { width: 90, lineBreak: false });

      const planSubmitted = !!r.planSubmittedAt;
      doc.fillColor(planSubmitted ? GREEN : RED)
        .text(planSubmitted ? 'Submitted' : 'Not Submitted', left + 280, rowY + 4, { width: 90, lineBreak: false });

      const achLabel = r.achievementStatus === 'COMPLETE' ? 'Complete' :
        r.achievementStatus === 'INCOMPLETE' ? 'Incomplete' :
          'Not Started';
      const achColor = r.achievementStatus === 'COMPLETE' ? GREEN :
        r.achievementStatus === 'INCOMPLETE' ? AMBER :
          RED;
      doc.fillColor(achColor)
        .text(achLabel, left + 380, rowY + 4, { width: 95, lineBreak: false });

      doc.x = left; // don't leave the cursor sitting under the Progress column
      doc.y = rowY + rowH + 2;
    }

    function tableHeader() {
      const y = doc.y;
      doc.rect(left, y, pageW, 16).fill(PRIMARY);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(WHITE);
      doc.text('Employee Name', left + 4, y + 4, { width: 170, lineBreak: false });
      doc.text('Emp. Code', left + 180, y + 4, { width: 90, lineBreak: false });
      doc.text('Plan Submitted', left + 280, y + 4, { width: 90, lineBreak: false });
      doc.text('Progress', left + 380, y + 4, { width: 95, lineBreak: false });
      doc.x = left;
      doc.y = y + 18;
    }

    // ── Cover ─────────────────────────────────────────────────────────────
    // Header band
    doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY);
    doc.fontSize(22).font('Helvetica-Bold').fillColor(WHITE)
      .text('Monthly KRA Activity Report', left, 20, { width: pageW });
    doc.fontSize(12).font('Helvetica').fillColor('#BFDBFE')
      .text(`Monthly Performance Plan — ${monthLabel}  ·  Grouped by ${groupLabel}`, left, 50, { width: pageW });

    doc.y = 100;

    // Summary box
    doc.rect(left, doc.y, pageW, 54).fill(GREY_LITE).stroke(GREY_LITE);
    const bY = doc.y + 10;
    doc.fontSize(10).font('Helvetica').fillColor(GREY_MID).text('Total Employees', left + 10, bY);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(GREY_DARK).text(String(rows.length), left + 10, bY + 14);

    doc.fontSize(10).font('Helvetica').fillColor(GREY_MID).text('Completed Employees', left + 120, bY);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(GREEN).text(String(compliant.length), left + 120, bY + 14);

    doc.fontSize(10).font('Helvetica').fillColor(GREY_MID).text('Non-Completed Employees', left + 230, bY);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(RED).text(String(nonCompliant.length), left + 230, bY + 14);

    const compliancePct = rows.length > 0
      ? Math.round((compliant.length / rows.length) * 100) : 0;
    doc.fontSize(10).font('Helvetica').fillColor(GREY_MID).text('Completion Rate', left + 360, bY);
    doc.fontSize(16).font('Helvetica-Bold')
      .fillColor(compliancePct >= 80 ? GREEN : compliancePct >= 50 ? AMBER : RED)
      .text(`${compliancePct}%`, left + 360, bY + 14);

    // Box is 54pt tall; land a short, deliberate 8pt gap below it rather than
    // the old +68 plus an extra moveDown(0.5) stacked on top of each other.
    doc.y += 54 + 8;

    // ── Employee status, grouped by RA/Department ──────────────────────────
    // Each RA/department appears exactly once, as its own card, with every
    // one of its employees in a single table sorted Completed → Incomplete →
    // Not Started (plan submitted) → Not Started (plan not submitted) — then
    // the next RA/department starts. (Previously each group's Completed and
    // Non-Completed employees were rendered as two separate sub-tables under
    // one group header; a reader now sees one ranked list per RA/department
    // instead of having to cross-reference two.)
    sectionTitle(`Employee Status by ${groupLabel}`, PRIMARY);
    // Composite priority: Complete → Incomplete → Not Started (plan
    // submitted) → Not Started (plan not submitted). achievementStatus alone
    // can't distinguish the last two — someone who submitted their plan but
    // hasn't started progress is further along than someone who submitted
    // nothing at all, and the report should read that way rather than
    // lumping both into one undifferentiated "Not Started" band.
    function statusRank(r) {
      if (r.achievementStatus === 'COMPLETE') return 0;
      if (r.achievementStatus === 'INCOMPLETE') return 1;
      return r.planSubmittedAt ? 2 : 3;
    }
    if (groups.length === 0) {
      doc.fontSize(9).fillColor(GREY_MID)
        .text('No employees found for the selected month.', left, doc.y, { width: pageW })
        .moveDown(0.5);
      doc.x = left;
    } else {
      groups.forEach(([groupName, groupRows], groupIdx) => {
        const completedCount = groupRows.filter(r => r.achievementStatus === 'COMPLETE').length;
        const pendingCount = groupRows.length - completedCount;
        // Stable sort (Node/V8 guarantees this): rows already tied on rank
        // keep their incoming order, which is why an RA's own row — first in
        // the array groupByRA/groupByDept hand us — stays at the top of its
        // own status band instead of shuffling around within it.
        const sortedRows = [...groupRows].sort(
          (a, b) => statusRank(a) - statusRank(b)
        );

        // Reserve room for the card header plus its table header and >=1 row
        // before starting a new RA/department block.
        if (doc.y + MIN_GROUP_BLOCK > pageBottom()) doc.addPage();
        groupHeader(groupName, groupRows.length, completedCount, pendingCount);

        tableHeader();
        sortedRows.forEach((r, i) => {
          if (doc.y + ROW_H > pageBottom()) { doc.addPage(); tableHeader(); }
          employeeRow(r, i);
        });
        doc.moveDown(0.4);

        // Thin divider between one RA/department card and the next —
        // skipped after the last group so the report doesn't end on a
        // trailing rule.
        if (groupIdx < groups.length - 1) {
          if (doc.y + 20 > pageBottom()) doc.addPage();
          doc.moveDown(0.2);
          hRule(doc.y);
          doc.moveDown(0.5);
        }
      });
    }

    // ── Legend: only when this report actually contains an Incomplete row ──
    // Complete/Not Started are self-explanatory from their labels alone;
    // Incomplete specifically means "Add More Plans" was used after progress
    // was already submitted, which isn't obvious without this note. Shown
    // once at the end of the document rather than repeated in every page's
    // thin footer strip, so it can actually be read.
    const hasIncomplete = rows.some(r => r.achievementStatus === 'INCOMPLETE');
    if (hasIncomplete) {
      if (doc.y + LEGEND_BREAK_BUFFER > pageBottom()) doc.addPage();
      sectionTitle('Understanding Progress Status', PRIMARY);
      doc.fontSize(9).fillColor(GREY_MID)
        .text('The Progress column above is defined as follows:', left, doc.y, { width: pageW });
      doc.moveDown(0.4);
      doc.x = left;

      function legendLine(label, color, explanation) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(color)
          .text(label, left, doc.y, { width: pageW, continued: true });
        doc.font('Helvetica').fillColor(GREY_DARK)
          .text(`  —  ${explanation}`);
        doc.x = left;
        doc.moveDown(0.35);
      }

      legendLine('Not Started', RED,
        'No progress has been submitted for this month\'s plan at all.');
      legendLine('Incomplete', AMBER,
        'Plan and progress were both submitted, but plan item(s) were added afterward via ' +
        '"Add More Plans" and progress has not yet been submitted for those newly added item(s).');
      legendLine('Complete', GREEN,
        'Plan and progress are both submitted, covering every plan item — including any added later.');
      doc.moveDown(0.3);
    }

    // ── Footer on each page ───────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const pageH = doc.page.height;
      const pageNum = i - range.start + 1;
      hRule(pageH - 40);

      // The footer text sits at (pageHeight - 30), which is inside the
      // bottom margin band by design (below the last content row). pdfkit
      // treats the margin as the page's content boundary, so writing text
      // past it makes pdfkit think the text doesn't fit and silently calls
      // addPage() on its own — appending a stray extra page per iteration
      // and leaving this loop's page numbers/totals wrong. Zeroing the
      // bottom margin just for this call lets us write inside that band
      // without triggering it, then we restore it immediately after.
      const savedBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7).fillColor(GREY_MID)
        .text(`Generated ${new Date().toLocaleString('en-IN')}  |  Page ${pageNum} of ${range.count}`,
          left, pageH - 30, { width: pageW, align: 'center' });
      doc.page.margins.bottom = savedBottomMargin;
    }

    doc.end();
  } catch (err) {
    console.error('[adminController] exportComplianceReportPdf error:', err);
    // Only send error header if headers haven't been flushed yet
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Failed to generate PDF', error: err.message });
    }
  }
};

/* ═════════════════════════════════════════════════════════════════════════════
   EMPLOYEE ACTIVITY LOG REPORT
   ─────────────────────────────────────────────────────────────────────────────
   Reads AuditLog — does not write to it. Every action shown here
   (DRAFT_SAVE / DRAFT_UPDATE / SUBMIT / RESUBMIT / ADD_PLAN_ITEMS /
   ADD_ACHIEVEMENT_ITEMS across Monthly Plan, Monthly Progress, Yearly Plan,
   and Yearly Appraisal Report) is already written by employeeController.js
   at the point the employee actually performs it — see
   utils/auditActionLabels.js for the full action-to-label mapping and for
   why supervisory/admin actions (RA's EVALUATE/RA_REJECT, admin's
   ACTIVATE_USER/DEACTIVATE_USER, etc.) are deliberately excluded from this
   report — this is "what did the employee themselves do," not "everything
   that touched their record."
═════════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────────────────
   SHARED DATA HELPER
   ─────────────────────────────────────────────────────────────────────────────
   Returns every AuditLog entry written BY an active-during-`month`
   EMPLOYEE/RA user (per fetchMonthlyComplianceData's roster — same
   month-aware isActive logic the compliance dashboard uses, so this
   report's roster can't silently drift from that one's), for entityTypes in
   EMPLOYEE_ACTIVITY_ENTITY_TYPES, timestamp-bounded to the calendar month —
   enriched with the employee's name/code/department/role, their resolved
   Reporting Authority for the month (same EmployeeRAHistory overlap query
   the RA-grouped compliance export uses), and a human-readable action label.

   `filters.entityType` narrows to one entity type (the caller validates it
   against EMPLOYEE_ACTIVITY_ENTITY_TYPES first). Omitted → all four.
────────────────────────────────────────────────────────────────────────────── */
async function fetchEmployeeActivityData(month, filters = {}) {
  const roster = await fetchMonthlyComplianceData(month, 'active');
  if (roster.length === 0) return { roster: [], rosterById: new Map(), logs: [] };

  const rosterById = new Map(roster.map(r => [r.id, r]));
  const employeeIds = roster.map(r => r.id);

  const [year, mon] = month.split('-').map(Number);
  const startOfMonth = new Date(year, mon - 1, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(year, mon, 0, 23, 59, 59, 999);

  const rawLogs = await AuditLog.findAll({
    where: {
      userId: { [Op.in]: employeeIds },
      entityType: {
        [Op.in]: filters.entityType ? [filters.entityType] : EMPLOYEE_ACTIVITY_ENTITY_TYPES,
      },
      timestamp: { [Op.gte]: startOfMonth, [Op.lte]: endOfMonth },
    },
    attributes: ['id', 'userId', 'action', 'entityType', 'entityId', 'timestamp'],
    order: [['timestamp', 'DESC']],
    raw: true,
  });

  // employeeId → [RA name, ...] (more than one only if reassigned mid-month —
  // same legitimate multi-RA overlap exportComplianceReportPdf's groupByRA
  // already handles).
  const employeeIdsByRA = await fetchEmployeeIdsByRAForMonth(month);
  const raNamesByEmployeeId = new Map();
  for (const [raId, empIdSet] of employeeIdsByRA.entries()) {
    const ra = rosterById.get(raId);
    if (!ra) continue; // RA wasn't active during this month per the roster
    for (const empId of empIdSet) {
      if (!raNamesByEmployeeId.has(empId)) raNamesByEmployeeId.set(empId, []);
      raNamesByEmployeeId.get(empId).push(ra.name);
    }
  }

  const logs = rawLogs.map(log => {
    const emp = rosterById.get(log.userId);
    return {
      id: log.id,
      timestamp: log.timestamp,
      employeeId: log.userId,
      name: emp ? emp.name : 'Unknown',
      employeeCode: emp ? emp.employeeCode : '—',
      department: emp ? emp.department : 'Unassigned',
      role: emp ? emp.role : null,
      reportingAuthority: (raNamesByEmployeeId.get(log.userId) || []).join(', ') || null,
      entityType: log.entityType,
      entityTypeLabel: entityTypeLabel(log.entityType),
      action: log.action,
      actionLabel: describeAuditAction(log.entityType, log.action),
      entityId: log.entityId,
    };
  });

  return { roster, rosterById, logs };
}

/* ─── Group flat log entries into one bucket per employee, entries sorted
   chronologically (oldest → newest, so each employee's card reads as a
   timeline) — used only by the PDF export; the JSON endpoint returns a flat,
   paginated, timestamp-sorted list instead (see getActivityLogReport). ──── */
function groupLogsByEmployee(logs) {
  const map = new Map();
  for (const log of logs) {
    if (!map.has(log.employeeId)) {
      map.set(log.employeeId, {
        employeeId: log.employeeId,
        name: log.name,
        employeeCode: log.employeeCode,
        department: log.department,
        role: log.role,
        reportingAuthority: log.reportingAuthority,
        entries: [],
      });
    }
    map.get(log.employeeId).entries.push(log);
  }
  for (const emp of map.values()) {
    emp.entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ─── Group employee-activity buckets by Department ─────────────────────── */
function groupEmployeesByDept(employees) {
  const map = new Map();
  for (const e of employees) {
    if (!map.has(e.department)) map.set(e.department, []);
    map.get(e.department).push(e);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ─── Group employee-activity buckets by Reporting Authority ────────────────
   Mirrors groupByRA's "Unassigned RA" bucket for anyone with no RA match
   this month. Unlike groupByRA, this doesn't need the two-pass
   superior/subordinate resolution — an RA's own logged activity (they carry
   the same plan/progress obligations as an employee) simply appears once,
   directly under whichever RA THEY report to, same as any other employee;
   it is not nested under a "team" concept the way the compliance export's
   card tallies are. ─────────────────────────────────────────────────────── */
function groupEmployeesByRA(employees) {
  const map = new Map();
  const unassigned = [];
  for (const e of employees) {
    const raNames = e.reportingAuthority ? e.reportingAuthority.split(', ') : [];
    if (raNames.length === 0) {
      unassigned.push(e);
      continue;
    }
    for (const raName of raNames) {
      if (!map.has(raName)) map.set(raName, []);
      map.get(raName).push(e);
    }
  }
  const groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (unassigned.length > 0) groups.push(['Unassigned RA', unassigned]);
  return groups;
}

/* ─── 5. GET /api/admin/activity-report ──────────────────────────────────────
   Flat, paginated, filterable list of individual AuditLog entries for the
   month — one row per logged action (not one row per employee), sorted by
   timestamp (most recent first) by default.

   Query params:
     month       (required, YYYY-MM)
     department  (optional — exact match on the normalized department value
                  returned in this response's own `departments` list)
     ra          (optional — Reporting Authority name, exact match against
                  this response's own `reportingAuthorities` list)
     entityType  (optional — one of EMPLOYEE_ACTIVITY_ENTITY_TYPES)
     search      (optional — matches employee name or employeeCode)
     sort        (timestamp | name | department — default timestamp)
     order       (asc | desc — default desc)
     page, limit (pagination — limit capped at 200, same shape as
                  getEmployeeList)
────────────────────────────────────────────────────────────────────────────── */
exports.getActivityLogReport = async (req, res) => {
  try {
    const { month, department, ra, search, sort = 'timestamp', order = 'desc' } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 25));

    if (!validateMonth(month)) {
      return res.status(400).json({ message: 'month query param is required (YYYY-MM)' });
    }

    let entityType;
    if (req.query.entityType) {
      if (!EMPLOYEE_ACTIVITY_ENTITY_TYPES.includes(req.query.entityType)) {
        return res.status(400).json({
          message: `entityType must be one of: ${EMPLOYEE_ACTIVITY_ENTITY_TYPES.join(', ')}`,
        });
      }
      entityType = req.query.entityType;
    }

    const { roster, logs } = await fetchEmployeeActivityData(month, { entityType });

    // ── Facets for the filter dropdowns — derived from the full month's
    //    data, BEFORE department/ra/search narrowing, so picking one filter
    //    doesn't shrink the option list for the others. ─────────────────────
    const departments = [...new Set(logs.map(r => r.department))].sort((a, b) => a.localeCompare(b));
    const reportingAuthorities = [...new Set(
      logs.flatMap(r => (r.reportingAuthority ? r.reportingAuthority.split(', ') : []))
    )].sort((a, b) => a.localeCompare(b));
    const employeesWithActivity = new Set(logs.map(r => r.employeeId)).size;

    // ── Filters (JS, same low-org-size rationale getEmployeeList uses) ─────
    let rows = logs;
    if (department) rows = rows.filter(r => r.department === department);
    if (ra) rows = rows.filter(r => (r.reportingAuthority || '').split(', ').includes(ra));
    if (search) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.employeeCode || '').toLowerCase().includes(q)
      );
    }

    // ── Sort ────────────────────────────────────────────────────────────
    const sortDir = order === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case 'name': return sortDir * (a.name || '').localeCompare(b.name || '');
        case 'department': return sortDir * (a.department || '').localeCompare(b.department || '');
        case 'timestamp':
        default:
          return sortDir * (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }
    });

    // ── Paginate ────────────────────────────────────────────────────────
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageRows = rows.slice((page - 1) * limit, page * limit);

    return res.json({
      month,
      totalEntries: logs.length,
      employeesWithActivity,
      trackedEmployees: roster.length,
      departments,
      reportingAuthorities,
      page,
      limit,
      total,
      totalPages,
      data: pageRows,
    });
  } catch (err) {
    console.error('[adminController] getActivityLogReport error:', err);
    return res.status(500).json({ message: 'Failed to load activity log report', error: err.message });
  }
};

/* ─── 6. GET /api/admin/activity-report/export-pdf ───────────────────────────
   Same underlying data as getActivityLogReport, unpaginated (the whole
   month), laid out as one card per Department/Reporting Authority, each
   containing one sub-block per employee with that employee's activity
   listed chronologically underneath.

   Employees with zero activity this month are not listed — this is an
   activity LOG, not a compliance report; "who submitted nothing" is already
   covered by the existing exportComplianceReportPdf endpoint, and repeating
   that list here (with nothing under it) would just be noise.

   Query params: month (required), groupBy (department default | ra),
   entityType (optional, same validation as the JSON endpoint).
────────────────────────────────────────────────────────────────────────────── */
exports.exportActivityLogReportPdf = async (req, res) => {
  try {
    const { month } = req.query;
    if (!validateMonth(month)) {
      return res.status(400).json({ message: 'month query param is required (YYYY-MM)' });
    }

    let entityType;
    if (req.query.entityType) {
      if (!EMPLOYEE_ACTIVITY_ENTITY_TYPES.includes(req.query.entityType)) {
        return res.status(400).json({
          message: `entityType must be one of: ${EMPLOYEE_ACTIVITY_ENTITY_TYPES.join(', ')}`,
        });
      }
      entityType = req.query.entityType;
    }

    const groupBy = req.query.groupBy === 'ra' ? 'ra' : 'department';

    const [year, mon] = month.split('-').map(Number);
    const monthLabel = new Date(year, mon - 1, 1).toLocaleString('en-US', {
      month: 'long', year: 'numeric',
    });

    const { logs } = await fetchEmployeeActivityData(month, { entityType });
    const employees = groupLogsByEmployee(logs);
    const groups = groupBy === 'ra' ? groupEmployeesByRA(employees) : groupEmployeesByDept(employees);
    const groupLabel = groupBy === 'ra' ? 'Reporting Authority' : 'Department';

    // ── Build PDF ───────────────────────────────────────────────────────
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="activity-log-${month}${groupBy === 'ra' ? '-by-ra' : ''}.pdf"`
    );
    doc.pipe(res);

    // ── Colour palette — intentionally matches exportComplianceReportPdf's
    //    palette (same hex values) so every admin PDF in this app reads as
    //    one consistent family, without importing state across the two
    //    independent PDFDocument instances. ─────────────────────────────
    const PRIMARY = '#185FA5';
    const GREEN = '#3B6D11';
    const GREY_DARK = '#1F2937';
    const GREY_MID = '#6B7280';
    const GREY_LITE = '#F3F4F6';
    const WHITE = '#FFFFFF';

    const pageW = doc.page.width - doc.options.margin * 2;
    const left = doc.options.margin;
    const MARGIN = doc.options.margin;
    const ROW_H = 16;
    const ENTRY_HEADER_H = 16;
    const CARD_HEADER_H = 22;
    const MIN_CARD_BLOCK = CARD_HEADER_H + ENTRY_HEADER_H + ROW_H;
    function pageBottom() { return doc.page.height - MARGIN; }

    function hRule(y, color = '#E5E7EB') {
      doc.moveTo(left, y).lineTo(left + pageW, y).strokeColor(color).lineWidth(0.5).stroke();
    }

    function sectionTitle(text, color = PRIMARY) {
      doc.y += 4;
      doc.fontSize(13).fillColor(color).font('Helvetica-Bold')
        .text(text, left, doc.y, { width: pageW });
      doc.y += 16;
      hRule(doc.y, color);
      doc.y += 6;
      doc.x = left;
    }

    // Group card header — right-hand tally is "N employees / M log entries"
    // rather than Completed/Pending, since this report has no completeness
    // concept the way the compliance report does.
    function groupHeader(groupName, employeeCount, entryCount) {
      const y = doc.y;
      const boxH = 22;
      doc.rect(left, y, pageW, boxH).fill(GREY_LITE);
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(GREY_DARK)
        .text(groupName, left + 8, y + 6, { width: pageW * 0.55, lineBreak: false });
      doc.fontSize(8).font('Helvetica-Bold').fillColor(GREY_MID)
        .text(
          `${employeeCount} employee${employeeCount !== 1 ? 's' : ''}  ·  ${entryCount} log ${entryCount !== 1 ? 'entries' : 'entry'}`,
          left + pageW * 0.55, y + 7, { width: pageW * 0.4, align: 'right', lineBreak: false }
        );
      doc.x = left;
      doc.y = y + boxH + 8;
    }

    function employeeHeader(emp) {
      const y = doc.y;
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(PRIMARY)
        .text(
          `${emp.name}  (${emp.employeeCode})${emp.role === 'RA' ? '  — RA' : ''}`,
          left + 4, y, { width: pageW - 8, lineBreak: false }
        );
      doc.x = left;
      doc.y = y + 14;
    }

    function entryTableHeader() {
      const y = doc.y;
      doc.rect(left + 4, y, pageW - 8, ENTRY_HEADER_H).fill(PRIMARY);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(WHITE);
      doc.text('Timestamp', left + 8, y + 3, { width: 130, lineBreak: false });
      doc.text('Action', left + 140, y + 3, { width: 260, lineBreak: false });
      doc.text('Record Type', left + 400, y + 3, { width: pageW - 8 - 360, lineBreak: false });
      doc.x = left;
      doc.y = y + ENTRY_HEADER_H;
    }

    function entryRow(entry, idx) {
      const y = doc.y;
      const bg = idx % 2 === 0 ? GREY_LITE : WHITE;
      doc.rect(left + 4, y, pageW - 8, ROW_H).fill(bg);
      doc.fontSize(7.5).font('Helvetica').fillColor(GREY_DARK);
      doc.text(
        new Date(entry.timestamp).toLocaleString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        left + 8, y + 3, { width: 130, lineBreak: false }
      );
      doc.text(entry.actionLabel, left + 140, y + 3, { width: 260, lineBreak: false });
      doc.fillColor(GREEN)
        .text(entry.entityTypeLabel, left + 400, y + 3, { width: pageW - 8 - 360, lineBreak: false });
      doc.x = left;
      doc.y = y + ROW_H;
    }

    // ── Cover ───────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY);
    doc.fontSize(22).font('Helvetica-Bold').fillColor(WHITE)
      .text('Employee Activity Log', left, 20, { width: pageW });
    doc.fontSize(12).font('Helvetica').fillColor('#BFDBFE')
      .text(
        `${monthLabel}  ·  Grouped by ${groupLabel}${entityType ? `  ·  ${entityTypeLabel(entityType)} only` : ''}`,
        left, 50, { width: pageW }
      );
    doc.y = 100;

    // Summary box
    const totalEmployees = employees.length;
    const totalEntries = logs.length;
    doc.rect(left, doc.y, pageW, 44).fill(GREY_LITE).stroke(GREY_LITE);
    const bY = doc.y + 10;
    doc.fontSize(10).font('Helvetica').fillColor(GREY_MID).text('Employees With Activity', left + 10, bY);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(GREY_DARK).text(String(totalEmployees), left + 10, bY + 14);
    doc.fontSize(10).font('Helvetica').fillColor(GREY_MID).text('Total Log Entries', left + 200, bY);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(PRIMARY).text(String(totalEntries), left + 200, bY + 14);
    doc.y += 44 + 8;

    // ── Activity, grouped by Department/RA ─────────────────────────────
    sectionTitle(`Activity by ${groupLabel}`, PRIMARY);

    if (groups.length === 0) {
      doc.fontSize(9).fillColor(GREY_MID)
        .text('No employee activity was recorded for the selected month.', left, doc.y, { width: pageW });
      doc.x = left;
    } else {
      groups.forEach(([groupName, groupEmployees], groupIdx) => {
        const groupEntryCount = groupEmployees.reduce((sum, e) => sum + e.entries.length, 0);
        if (doc.y + MIN_CARD_BLOCK > pageBottom()) doc.addPage();
        groupHeader(groupName, groupEmployees.length, groupEntryCount);

        groupEmployees.forEach(emp => {
          if (doc.y + ENTRY_HEADER_H + ROW_H + 14 > pageBottom()) doc.addPage();
          employeeHeader(emp);
          entryTableHeader();
          emp.entries.forEach((entry, i) => {
            if (doc.y + ROW_H > pageBottom()) { doc.addPage(); entryTableHeader(); }
            entryRow(entry, i);
          });
          doc.moveDown(0.4);
        });

        if (groupIdx < groups.length - 1) {
          if (doc.y + 20 > pageBottom()) doc.addPage();
          doc.moveDown(0.2);
          hRule(doc.y);
          doc.moveDown(0.5);
        }
      });
    }

    // ── Footer on each page ─────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const pageH = doc.page.height;
      const pageNum = i - range.start + 1;
      hRule(pageH - 40);
      const savedBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7).fillColor(GREY_MID)
        .text(`Generated ${new Date().toLocaleString('en-IN')}  |  Page ${pageNum} of ${range.count}`,
          left, pageH - 30, { width: pageW, align: 'center' });
      doc.page.margins.bottom = savedBottomMargin;
    }

    doc.end();
  } catch (err) {
    console.error('[adminController] exportActivityLogReportPdf error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Failed to generate activity log PDF', error: err.message });
    }
  }
};