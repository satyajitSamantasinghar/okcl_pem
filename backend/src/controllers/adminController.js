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
   render through the exact same PDF-drawing loop below. Called ONCE, on the
   full month's row set (Completed and Non-Completed together) — the PDF
   render loop is what later splits each group's rows into its Completed/
   Non-Completed sub-tables, so every RA appears exactly once here. Each RA's
   own compliance row (they carry the same plan/progress obligations as an
   employee — see ADMIN_TRACKED_ROLES) is prepended to their own group so it
   isn't just implied by the group header — it's an actual row a reader can
   check, styled distinctly by employeeRow(). Regular employees with no RA
   match for the month land in an "Unassigned RA" bucket, same reasoning as
   the department view's "Unassigned" department bucket. ──
*/
function groupByRA(list, employeeIdsByRA, raById) {
  const employeeRows = list.filter(r => r.role === 'EMPLOYEE');
  const raSelfRows = list.filter(r => r.role === 'RA'); // RA's own compliance row, if in this list

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

    // Group the FULL row set (compliant + non-compliant together) by RA/
    // department, once. Each group's rows are split into Completed /
    // Non-Completed only at render time, below — this is what lets every
    // RA/Department appear exactly once in the report, with both of its
    // sub-tables nested underneath it, instead of the old layout where an
    // RA/department could be listed once under "Completed" and again,
    // separately, under "Non-Completed".
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
    const SUB_HEADER_H = 16;                             // subsectionHeader() line + its spacing
    // A group can't open at the very bottom of a page with nothing under it:
    // reserve room for the group's own header PLUS at least one populated
    // sub-section (its own header, the table header, and >=1 row) before
    // starting a new RA/department block.
    const MIN_GROUP_BLOCK = GROUP_HEADER_H + SUB_HEADER_H + TABLE_HEADER_H + ROW_H;
    // Once a group header is already drawn, a fresh sub-section within it
    // only needs room for its own header + table header + >=1 row.
    const MIN_SUBSECTION_BLOCK = SUB_HEADER_H + TABLE_HEADER_H + ROW_H;
    const LEGEND_BREAK_BUFFER = 120;                     // == old flat "page.height - 170"
    function pageBottom() { return doc.page.height - MARGIN; } // usable bottom edge

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

    // Group header = one RA/department "card": a shaded band with the
    // group's name on the left and a compact Total/Completed/Pending
    // tally on the right, so a reader can see that RA or department's
    // whole standing at a glance before reading its two sub-tables below.
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

    // Sub-section header = the "Completed" / "Non-Completed" label nested
    // under a group's card, indented slightly so it visually reads as a
    // child of the group above it rather than a peer section of its own.
    function subsectionHeader(label, count, color) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(color)
        .text(`${label}  (${count})`, left + 6, doc.y, { width: pageW - 6 });
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

    // ── Employee status, grouped by RA/Department ──────────────────────────
    // Each RA/department appears exactly once, as its own card, with its
    // Completed employees listed first and its Non-Completed employees
    // listed directly beneath — then the next RA/department starts. This
    // replaces the old layout, which listed every RA/department once under
    // a page-wide "Completed" section and a second time under a separate
    // "Non-Completed" section, forcing a reader to jump between two places
    // to see one RA/department's full picture.
    sectionTitle(`Employee Status by ${groupLabel}`, PRIMARY);
    if (groups.length === 0) {
      doc.fontSize(9).fillColor(GREY_MID)
        .text('No employees found for the selected month.', left, doc.y, { width: pageW })
        .moveDown(0.5);
      doc.x = left;
    } else {
      groups.forEach(([groupName, groupRows], groupIdx) => {
        const groupCompliant = groupRows.filter(r => r.achievementStatus === 'COMPLETE');
        const groupNonCompliant = groupRows.filter(r => r.achievementStatus !== 'COMPLETE');

        // Reserve room for the card header plus at least its first
        // sub-section before starting a new RA/department block.
        if (doc.y + MIN_GROUP_BLOCK > pageBottom()) doc.addPage();
        groupHeader(groupName, groupRows.length, groupCompliant.length, groupNonCompliant.length);

        if (groupCompliant.length > 0) {
          if (doc.y + MIN_SUBSECTION_BLOCK > pageBottom()) doc.addPage();
          subsectionHeader('Completed', groupCompliant.length, GREEN);
          tableHeader();
          groupCompliant.forEach((r, i) => {
            if (doc.y + ROW_H > pageBottom()) { doc.addPage(); tableHeader(); }
            employeeRow(r, i);
          });
          doc.moveDown(0.4);
        }

        if (groupNonCompliant.length > 0) {
          if (doc.y + MIN_SUBSECTION_BLOCK > pageBottom()) doc.addPage();
          subsectionHeader('Non-Completed', groupNonCompliant.length, RED);
          tableHeader();
          groupNonCompliant.forEach((r, i) => {
            if (doc.y + ROW_H > pageBottom()) { doc.addPage(); tableHeader(); }
            employeeRow(r, i);
          });
          doc.moveDown(0.4);
        }

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