'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN CONTROLLER
//
//  Three handlers scoped to a given month (query param `month`, "YYYY-MM"):
//    1. getDashboardSummary   — org-wide + per-dept counts
//    2. getEmployeeList       — paginated, filterable, sortable employee list
//    3. exportComplianceReportPdf — streams a PDF compliance report, grouped
//       by department (default) or by Reporting Authority (?groupBy=ra)
//
//  All three share a single helper (fetchMonthlyComplianceData) that does the
//  heavy DB lifting once per request — no N+1 per-employee loops.
//
//  Completeness definition is always delegated to isAchievementCompleteForPlan
//  (the single shared implementation) — never re-derived inline.
//
//  The RA-grouped export resolves "which RA is this employee mapped to this
//  month" via EmployeeRAHistory (date-overlap), NOT the live
//  User.reportingAuthorityId snapshot — see fetchEmployeeIdsByRAForMonth for
//  why. This mirrors raController.js's getRADashboard query; if that ever
//  gets extracted into a shared util, point this at it instead of hand-
//  keeping two copies in sync.
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
} = require('../models');

const { isAchievementCompleteForPlan } = require('../utils/achievementCompleteness');

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

   Each entry shape:
   {
     id, name, employeeCode, department, email,
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
async function fetchMonthlyComplianceData(month) {
  // ── 1. All active EMPLOYEE + RA users (not HRD/MD/ADMIN) ───────────────────
  //       RAs carry their own monthly plan/achievement obligations just like
  //       employees do, so they're counted here too. If you later want the
  //       admin org-wide view to also cover HRD/MD, extend ADMIN_TRACKED_ROLES.
  const employees = await User.findAll({
    where: { role: { [Op.in]: ADMIN_TRACKED_ROLES }, isActive: true },
    attributes: ['id', 'name', 'employeeCode', 'department', 'email', 'role'],
    order: [['name', 'ASC']],
  });

  if (employees.length === 0) return [];

  const employeeIds = employees.map(e => e.id);

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
  return employees.map(emp => {
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
   render through the exact same PDF-drawing loop below. Each RA's own
   compliance row (they carry the same plan/progress obligations as an
   employee — see ADMIN_TRACKED_ROLES) is prepended to their own group so it
   isn't just implied by the group header — it's an actual row a reader can
   check, styled distinctly by employeeRow(). Regular employees with no RA
   match for the month land in an "Unassigned RA" bucket, same reasoning as
   the department view's "Unassigned" department bucket. ──
*/
function groupByRA(list, employeeIdsByRA, raById) {
  const employeeRows = list.filter(r => r.role === 'EMPLOYEE');
  const raSelfRows = list.filter(r => r.role === 'RA'); // RAs whose own status falls in THIS subset

  const raIdsWithReports = [...employeeIdsByRA.keys()].filter(raId => raById.has(raId));
  const raIdsWithSelfRow = raSelfRows.map(r => r.id);
  const allRaIds = [...new Set([...raIdsWithReports, ...raIdsWithSelfRow])]
    .sort((a, b) => raById.get(a).name.localeCompare(raById.get(b).name));

  const groups = [];
  const claimedEmployeeIds = new Set();

  for (const raId of allRaIds) {
    const ra = raById.get(raId);
    const empIds = employeeIdsByRA.get(raId) || new Set();
    const matchedEmployees = employeeRows.filter(r => empIds.has(r.id));
    const raSelfRow = raSelfRows.find(r => r.id === raId) || null;

    if (matchedEmployees.length === 0 && !raSelfRow) continue; // nothing to show for this RA in this subset

    const tableRows = raSelfRow ? [raSelfRow, ...matchedEmployees] : matchedEmployees;
    groups.push([`${ra.name}  (${ra.employeeCode})`, tableRows]);
    matchedEmployees.forEach(r => claimedEmployeeIds.add(r.id));
  }

  const unassigned = employeeRows.filter(r => !claimedEmployeeIds.has(r.id));
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

    return res.json({
      month,
      totalEmployees,
      planSubmitted,
      achievementSubmitted,
      noPlan,
      planOnlyOrIncomplete,
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
    let rows = await fetchMonthlyComplianceData(month);

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

/* ─── 3. GET /api/admin/export-pdf ──────────────────────────────────────── */
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

    let compliantGroups, nonCompliantGroups, groupLabel;
    if (groupBy === 'ra') {
      const employeeIdsByRA = await fetchEmployeeIdsByRAForMonth(month);
      const raById = new Map(rows.filter(r => r.role === 'RA').map(r => [r.id, r]));
      compliantGroups = groupByRA(compliant, employeeIdsByRA, raById);
      nonCompliantGroups = groupByRA(nonCompliant, employeeIdsByRA, raById);
      groupLabel = 'Reporting Authority';
    } else {
      compliantGroups = groupByDept(compliant);
      nonCompliantGroups = groupByDept(nonCompliant);
      groupLabel = 'Department';
    }

    // ── Build PDF ─────────────────────────────────────────────────────────
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

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

    function hRule(y, color = '#E5E7EB') {
      doc.moveTo(left, y).lineTo(left + pageW, y).strokeColor(color).lineWidth(0.5).stroke();
    }

    function sectionTitle(text, color = PRIMARY) {
      doc.moveDown(0.6);
      doc.fontSize(13).fillColor(color).font('Helvetica-Bold')
        .text(text, left, doc.y, { width: pageW });
      doc.moveDown(0.3);
      hRule(doc.y, color);
      doc.moveDown(0.4);
      doc.x = left; // pdfkit leaves doc.x wherever the text() call above put it — pin it back
    }

    function groupHeader(groupName, count, color) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(color)
        .text(`${groupName}  (${count})`, left, doc.y, { width: pageW });
      doc.moveDown(0.2);
      doc.x = left;
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

    doc.y += 68;
    doc.moveDown(0.5);

    // ── Section 1: Compliant employees ────────────────────────────────────
    sectionTitle('Completed Employees  —  Submitted Plan & Complete Progress', GREEN);
    if (compliantGroups.length === 0) {
      doc.fontSize(9).fillColor(GREY_MID)
        .text('No employees in this category for the selected month.', left, doc.y, { width: pageW })
        .moveDown(0.5);
      doc.x = left;
    } else {
      for (const [groupName, groupRows] of compliantGroups) {
        // Check if we need a new page
        if (doc.y > doc.page.height - 80) doc.addPage();
        groupHeader(groupName, groupRows.length, GREEN);
        tableHeader();
        groupRows.forEach((r, i) => {
          if (doc.y > doc.page.height - 40) { doc.addPage(); tableHeader(); }
          employeeRow(r, i);
        });
        doc.moveDown(0.6);
      }
    }

    // ── Section 2: Non-Compliant employees ────────────────────────────────
    if (doc.y > doc.page.height - 120) doc.addPage();
    sectionTitle('Non-Completed Employees  —  Missing Plan or Progress', RED);
    if (nonCompliantGroups.length === 0) {
      doc.fontSize(9).fillColor(GREY_MID)
        .text('No employees in this category for the selected month.', left, doc.y, { width: pageW })
        .moveDown(0.5);
      doc.x = left;
    } else {
      for (const [groupName, groupRows] of nonCompliantGroups) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        groupHeader(groupName, groupRows.length, RED);
        tableHeader();
        groupRows.forEach((r, i) => {
          if (doc.y > doc.page.height - 40) { doc.addPage(); tableHeader(); }
          employeeRow(r, i);
        });
        doc.moveDown(0.6);
      }
    }

    // ── Legend: only when this report actually contains an Incomplete row ──
    // Complete/Not Started are self-explanatory from their labels alone;
    // Incomplete specifically means "Add More Plans" was used after progress
    // was already submitted, which isn't obvious without this note. Shown
    // once at the end of the document rather than repeated in every page's
    // thin footer strip, so it can actually be read.
    const hasIncomplete = rows.some(r => r.achievementStatus === 'INCOMPLETE');
    if (hasIncomplete) {
      if (doc.y > doc.page.height - 170) doc.addPage();
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
        'No progress/achievement has been submitted for this month\'s plan at all.');
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
      doc.fontSize(7).fillColor(GREY_MID)
        .text(`Generated ${new Date().toLocaleString('en-IN')}  |  Page ${pageNum} of ${range.count}`,
          left, pageH - 30, { width: pageW, align: 'center' });
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