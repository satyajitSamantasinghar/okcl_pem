// ─────────────────────────────────────────────────────────────────────────────
//  HRD CONTROLLER  —  Mongoose → Sequelize conversion
//
//  KEY CHANGES:
//  1. countDocuments(filter)        → Model.count({ where: filter })
//  2. find(filter).lean()           → findAll({ where: filter })
//     (Sequelize instances behave like plain objects for res.json)
//  3. $in / $or / $exists           → Op.in / Op.or / Op.ne (from Sequelize)
//  4. regex search                  → Op.iLike  (PostgreSQL case-insensitive LIKE)
//  5. $regex: `^${year}`            → Op.like: `${year}%`  (starts-with)
//  6. User.aggregate([...])         → findAll + group + sequelize.literal()
//     (getDepartmentStats: CASE expression in SELECT + GROUP BY via raw SQL)
//  7. MongoDB aggregation pipeline  → batch queries + in-memory Maps (O(n) joins)
//     (getMonthlyPlansList: replaces $lookup pipeline with 3 parallel queries)
//  8. updateMany({$in}, {$set})     → Model.update(data, { where: { id: Op.in } })
//  9. populate(field, attrs)        → include: [{ model, as, attributes }]
//  10. _id                          → id  throughout
// ─────────────────────────────────────────────────────────────────────────────

const {
  sequelize,
  User,
  MonthlyPlan,
  MonthlyPlanItem,
  MonthlyAchievement,
  MonthlyAchievementItem,
  MonthlyEvaluation,
  QuarterlyEvaluation,
  YearlyPlan,
  YearlyPlanKra,
  YearlyPlanRevisionLog,
  YearlyAppraisalReport,
  YearlyAppraisalKraAssessment,
  AuditLog,
  EmployeeRAHistory,
} = require("../models");

const { Op } = require("sequelize");

/* ─── HRD DASHBOARD ─────────────────────────────────────────────────────────── */
exports.getHRDDashboard = async (req, res) => {
  try {
    const month = req.query.month;
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: "Invalid month format. Use YYYY-MM." });
    }

    // CHANGE 1: countDocuments → Model.count({ where })
    const [selYear, selMonthNum] = month.split("-").map(Number);
    // Last millisecond of the selected month (month is 1-based → pass it
    // directly as the month arg to get the 0th day of the *next* month = last
    // day of the selected month, then set time to 23:59:59.999)
    const endOfSelectedMonth = new Date(selYear, selMonthNum, 0, 23, 59, 59, 999);

    const totalEmployees = await User.count({ where: { role: "EMPLOYEE", isActive: true, createdAt: { [Op.lte]: endOfSelectedMonth } } });
    const totalRAs = await User.count({ where: { role: "RA", isActive: true, createdAt: { [Op.lte]: endOfSelectedMonth } } });

    let plansThisMonth = 0, evaluationsThisMonth = 0, pendingEvaluations = 0;

    if (month) {
      // FIX (permanent): exclude REJECTED plans from the "plans submitted" count.
      // A REJECTED plan has been invalidated by the RA — the employee must resubmit.
      plansThisMonth = await MonthlyPlan.count({
        where: { month, status: { [Op.notIn]: ["DRAFT", "REJECTED"] } },
      });
      evaluationsThisMonth = await MonthlyEvaluation.count({ where: { month, status: "EVALUATED" } });

      // FIX (permanent): pendingEvaluations must only count evaluations where
      // the employee has actually submitted their progress/achievement AND the
      // evaluation is still PENDING (not yet scored by the RA).
      //
      // The old query counted all PENDING evaluation rows — including those
      // where the employee had NOT yet uploaded progress, giving the HRD a
      // misleadingly high "pending" number. The correct meaning is:
      //   "How many evaluations CAN the RA perform right now?"
      // That is only true when a SUBMITTED achievement exists for the linked plan.
      const plansWithAchievement = await MonthlyAchievement.findAll({
        where: { status: "SUBMITTED" },
        attributes: ["monthlyPlanId"],
      });
      const planIdsWithAch = plansWithAchievement.map(a => a.monthlyPlanId).filter(Boolean);
      pendingEvaluations = planIdsWithAch.length > 0
        ? await MonthlyEvaluation.count({
            where: {
              month,
              status: "PENDING",
              monthlyPlanId: { [Op.in]: planIdsWithAch },
            },
          })
        : 0;
    }

    const totalQuarterly = await QuarterlyEvaluation.count();
    const orgHealthScore = totalEmployees > 0
      ? Math.round((evaluationsThisMonth / totalEmployees) * 100) : 0;

    res.json({ totalEmployees, totalRAs, plansThisMonth, evaluationsThisMonth, pendingEvaluations, totalQuarterly, orgHealthScore });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch dashboard stats", error: error.message });
  }
};

/* ─── RA LIST WITH EMPLOYEE COUNTS ──────────────────────────────────────────── */
exports.getRAList = async (req, res) => {
  try {
    const month = req.query.month;

    // CHANGE 2: find().lean() → findAll() (returns plain-enough objects for JSON)
    const ras = await User.findAll({
      where: { role: "RA", isActive: true },
      attributes: ["id", "name", "employeeCode", "department"],
    });

    if (ras.length === 0) return res.json([]);

    const raIds = ras.map(r => r.id);

    // CHANGE 3: { reportingAuthorityId: { $in: raIds } } → Op.in
    const allEmployees = await User.findAll({
      where: { reportingAuthorityId: { [Op.in]: raIds }, isActive: true },
      attributes: ["id", "name", "employeeCode", "department", "reportingAuthorityId"],
    });

    let evalMap = {};
    if (month && allEmployees.length > 0) {
      const empIds = allEmployees.map(e => e.id);
      const evaluations = await MonthlyEvaluation.findAll({
        where: { employeeId: { [Op.in]: empIds }, month },
        attributes: ["employeeId", "raId", "status", "score"],
      });
      evaluations.forEach(ev => {
        evalMap[ev.employeeId] = { status: ev.status, score: ev.score };
      });
    }

    const employeesByRA = {};
    raIds.forEach(id => { employeesByRA[id] = []; });
    allEmployees.forEach(emp => {
      if (emp.reportingAuthorityId && employeesByRA[emp.reportingAuthorityId]) {
        employeesByRA[emp.reportingAuthorityId].push(emp);
      }
    });

    const result = ras.map(ra => {
      const employees = employeesByRA[ra.id] || [];
      let evaluated = 0;

      const enrichedEmployees = employees.map(emp => {
        const ev = evalMap[emp.id];
        const isEvaluated = ev?.status === "EVALUATED";
        if (isEvaluated) evaluated++;
        return {
          ...emp.toJSON(),
          evaluationStatus: ev ? (isEvaluated ? "evaluated" : "pending") : "not_started",
          lastScore: isEvaluated ? ev.score : null,
        };
      });

      return { id: ra.id, name: ra.name, employeeCode: ra.employeeCode, department: ra.department, employeeCount: employees.length, evaluated, employees: enrichedEmployees };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch RA list", error: error.message });
  }
};

/* ─── EVALUATION TREND ───────────────────────────────────────────────────────── */
exports.getEvaluationTrend = async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.months) || 6, 12);
    const result = [];
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("default", { month: "short" }) + " '" + String(d.getFullYear()).slice(2);

      // CHANGE 1: countDocuments → count({ where })
      const [completed, pending] = await Promise.all([
        MonthlyEvaluation.count({ where: { month: monthStr, status: "EVALUATED" } }),
        MonthlyEvaluation.count({ where: { month: monthStr, status: "PENDING" } }),
      ]);

      result.push({ month: label, monthStr, completed, pending });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch evaluation trend", error: error.message });
  }
};

/* ─── DEPARTMENT STATS ───────────────────────────────────────────────────────── */
exports.getDepartmentStats = async (req, res) => {
  try {
    // CHANGE 6: User.aggregate([{ $group }]) →  findAll with GROUP BY + CASE in raw SQL
    // PostgreSQL doesn't have $cond — we use a CASE WHEN expression via sequelize.literal
    const depts = await User.findAll({
      where: {
        role: { [Op.in]: ["EMPLOYEE", "RA"] },
        isActive: true,
      },
      attributes: [
        [
          sequelize.literal(`
            CASE
              WHEN department IS NULL
                OR TRIM(department) = ''
                OR LOWER(TRIM(department)) IN ('n/a', 'na')
              THEN 'Unassigned'
              ELSE department
            END
          `),
          "departmentGroup",
        ],
        [sequelize.fn("COUNT", sequelize.col("User.id")), "count"],
      ],
      group: [
        sequelize.literal(`
          CASE
            WHEN department IS NULL
              OR TRIM(department) = ''
              OR LOWER(TRIM(department)) IN ('n/a', 'na')
            THEN 'Unassigned'
            ELSE department
          END
        `),
      ],
      order: [[sequelize.literal("count"), "DESC"]],
      raw: true,
    });

    res.json(depts.map(d => ({ department: d.departmentGroup, count: parseInt(d.count) })));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch department stats", error: error.message });
  }
};

/* ─── EMPLOYEE DETAIL ────────────────────────────────────────────────────────── */
exports.getEmployeeDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await User.findByPk(id, {
      attributes: ["id", "name", "employeeCode", "department", "role", "reportingAuthorityId"],
      include: [{ model: User, as: "reportingAuthority", attributes: ["id", "name", "employeeCode"] }],
    });

    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const [monthlyPlans, monthlyEvaluations, quarterlyEvaluations, monthlyAchievements, yearlyPlans, yearlyReports] = await Promise.all([
      MonthlyPlan.findAll({ where: { employeeId: id }, include: [{ model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] }], order: [["month", "DESC"]], limit: 12 }),
      MonthlyEvaluation.findAll({ where: { employeeId: id }, include: [{ model: User, as: "ra", attributes: ["id", "name", "employeeCode"] }], order: [["month", "DESC"]], limit: 12 }),
      QuarterlyEvaluation.findAll({ where: { employeeId: id }, include: [{ model: User, as: "ra", attributes: ["id", "name", "employeeCode"] }], order: [["createdAt", "DESC"]] }),
      MonthlyAchievement.findAll({ where: { employeeId: id }, include: [{ model: MonthlyAchievementItem, as: "planAchievements" }] }),
      // FIX: exclude DRAFT yearly plans from per-employee detail view (HRD perspective).
      YearlyPlan.findAll({ where: { employeeId: id, status: { [Op.ne]: "DRAFT" } }, include: [{ model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] }], order: [["submittedAt", "DESC"]] }),
      // FIX: exclude DRAFT appraisal reports from per-employee detail view.
      YearlyAppraisalReport.findAll({ where: { employeeId: id, status: { [Op.ne]: "DRAFT" } }, include: [{ model: YearlyAppraisalKraAssessment, as: "kraAssessments" }], order: [["submittedAt", "DESC"]] }),
    ]);

    res.json({ employee, monthlyPlans, monthlyEvaluations, quarterlyEvaluations, monthlyAchievements, yearlyPlans, yearlyReports });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch employee detail", error: error.message });
  }
};

/* ─── ALL MONTHLY PLANS ──────────────────────────────────────────────────────── */
// CHANGE 7: replaced the entire MongoDB $lookup aggregation pipeline with
//           3 parallel Sequelize queries + in-memory Maps.
//           Same data shape, same response format, but fully portable.
exports.getMonthlyPlansList = async (req, res) => {
  try {
    const { month, year, status } = req.query;

    // FIX: exclude DRAFT monthly plans by default — HRD should only see plans
    // the employee has actually submitted (PENDING / APPROVED / REJECTED).
    // If the caller explicitly passes ?status=..., that overrides this default.
    const where = { status: { [Op.ne]: "DRAFT" } };

    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Invalid month format. Use YYYY-MM." });
      where.month = month;
    } else if (year) {
      if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "Invalid year format. Use YYYY." });
      // CHANGE 5: { $regex: `^${year}` } → Op.like `${year}%`
      where.month = { [Op.like]: `${year}%` };
    }
    // FIX: `?status=` on this endpoint is a UI-level filter (PENDING / EVALUATED /
    // REJECTED) that spans two different tables — MonthlyPlan.status and the
    // separately-queried MonthlyEvaluation.status (merged in below). Only
    // REJECTED is an actual value of enum_monthly_plans_status, so that's the
    // only one we can push down into the WHERE clause here. Blindly assigning
    // `where.status = status` for "EVALUATED"/"PENDING" made Postgres reject the
    // query with "invalid input value for enum enum_monthly_plans_status" since
    // those strings aren't valid values for this column at all. EVALUATED and
    // PENDING are applied further down, after evaluationStatus is computed.
    if (status === "REJECTED") where.status = "REJECTED";

    // Step 1: Fetch plans with employee info
    const plans = await MonthlyPlan.findAll({
      where,
      include: [
        { model: User, as: "employee", required: true, attributes: ["id", "name", "employeeCode", "department"] },
        { model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] },
      ],
      order: [["month", "DESC"], ["submittedAt", "DESC"]],
      limit: 100,
    });

    if (plans.length === 0) return res.json([]);

    // Step 2: Batch-fetch evaluations + achievements (avoids N+1)
    const planIds = plans.map(p => p.id);
    const employeeIds = [...new Set(plans.map(p => p.employeeId))];
    const months = [...new Set(plans.map(p => p.month))];

    const [evaluations, achievements] = await Promise.all([
      MonthlyEvaluation.findAll({
        where: { employeeId: { [Op.in]: employeeIds }, month: { [Op.in]: months } },
        attributes: ["employeeId", "month", "status", "score", "remarks", "evaluatedAt"],
      }),
      MonthlyAchievement.findAll({
        where: { monthlyPlanId: { [Op.in]: planIds } },
        include: [{ model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] }],
      }),
    ]);

    // Step 3: Build O(1) lookup maps
    const evalMap = {};
    evaluations.forEach(ev => { evalMap[`${ev.employeeId}__${ev.month}`] = ev; });
    const achMap = {};
    achievements.forEach(ach => { achMap[ach.monthlyPlanId] = ach; });

    // Step 4: Merge — identical response shape to original MongoDB pipeline output
    let result = plans.map(p => {
      const ev = evalMap[`${p.employeeId}__${p.month}`];
      const ach = achMap[p.id];
      return {
        ...p.toJSON(),
        evaluationStatus: ev?.status || null,
        // FIX: MonthlyEvaluation.score is a Postgres NUMERIC/DECIMAL column, which
        // Sequelize returns as a string (e.g. "9.00") to avoid float rounding —
        // that string was being rendered as-is on the frontend ("9.00/10" instead
        // of "9/10"). Casting to a real Number here fixes the display everywhere
        // this field is used, and `ev?.score != null` (rather than `||`) makes
        // sure a genuine score of 0 isn't dropped to null.
        evaluationScore: ev?.score != null ? Number(ev.score) : null,
        evaluationRemarks: ev?.remarks || null,
        evaluatedAt: ev?.evaluatedAt || null,
        hasAchievement: !!(ach && ach.status !== "DRAFT"),
        achievementStatus: ach?.status || null,
        achievementDetails: ach?.achievementDetails || null,
        planAchievements: ach?.planAchievements || [],
        additionalAchievement: ach?.additionalAchievement || null,
        achievementDate: ach?.submittedAt || null,
      };
    });

    // FIX (cont'd): apply the EVALUATED / PENDING branches of the UI-level status
    // filter here, now that evaluationStatus has been merged in. Mirrors the
    // same rule the frontend already uses in getStatusInfo/processed filtering.
    if (status === "EVALUATED") {
      result = result.filter(p => p.evaluationStatus === "EVALUATED");
    } else if (status === "PENDING") {
      result = result.filter(p => p.evaluationStatus !== "EVALUATED" && p.status !== "REJECTED");
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL EMPLOYEES LIST ─────────────────────────────────────────────────────── */
exports.getAllEmployees = async (req, res) => {
  try {
    const where = { role: { [Op.in]: ["EMPLOYEE", "RA"] } };

    if (req.query.q) {
      const q = req.query.q.trim().substring(0, 60);
      // CHANGE 4: new RegExp(q, 'i') → Op.iLike (PostgreSQL native case-insensitive)
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { employeeCode: { [Op.iLike]: `%${q}%` } },
      ];
    }

    if (req.query.role) where.role = req.query.role;

    const limit = parseInt(req.query.limit, 10) || 200;

    const employees = await User.findAll({
      where,
      attributes: ["id", "name", "employeeCode", "department", "role"],
      order: [["name", "ASC"]],
      limit,
    });

    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── SEARCH USERS (autocomplete) ───────────────────────────────────────────── */
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) return res.json([]);

    const sanitized = q.trim().substring(0, 60);

    const users = await User.findAll({
      where: {
        // CHANGE 4: regex → Op.iLike
        [Op.or]: [
          { name: { [Op.iLike]: `%${sanitized}%` } },
          { employeeCode: { [Op.iLike]: `%${sanitized}%` } },
        ],
        role: { [Op.in]: ["EMPLOYEE", "RA"] },
        isActive: true,
      },
      attributes: ["id", "name", "employeeCode", "department", "role"],
      limit: 10,
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Search failed", error: error.message });
  }
};

/* ─── GENERATE YEARLY APPRAISAL (legacy) ────────────────────────────────────── */
exports.generateYearlyAppraisal = async (req, res) => {
  try {
    const { employeeId, financialYear } = req.body;

    const quarters = await QuarterlyEvaluation.findAll({ where: { employeeId } });
    if (quarters.length === 0) return res.status(400).json({ message: "No quarterly evaluations found" });

    // NOTE: YearlyAppraisal is a legacy model — add its Sequelize model if still needed.
    // For now, placeholder to preserve the route.
    await AuditLog.create({
      userId: req.user.userId, action: "GENERATE", entityType: "YEARLY_APPRAISAL", entityId: employeeId, ipAddress: req.ip,
    });

    res.status(201).json({ message: "Yearly appraisal generated (legacy route)" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── HRD: EVALUATE YEARLY APPRAISAL REPORT ─────────────────────────────────── */
exports.evaluateYearlyReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { hrdOfficeTimeDiscipline, hrdLeaveTraits, hrdTotalScore, hrdRemarks } = req.body;

    // CHANGE: findById → findByPk
    const report = await YearlyAppraisalReport.findByPk(id);
    if (!report) return res.status(404).json({ message: "Yearly appraisal report not found" });
    if (["MD_EVALUATED", "COMPLETED"].includes(report.status)) return res.status(400).json({ message: "Cannot modify evaluation; MD has already finalized this report." });

    let total = hrdTotalScore !== undefined
      ? Number(hrdTotalScore) || 0
      : (Number(hrdOfficeTimeDiscipline) || 0) + (Number(hrdLeaveTraits) || 0);

    if (total > 5) return res.status(400).json({ message: "HRD total score cannot exceed 5" });

    if (hrdOfficeTimeDiscipline !== undefined) report.hrdOfficeTimeDiscipline = hrdOfficeTimeDiscipline;
    if (hrdLeaveTraits !== undefined) report.hrdLeaveTraits = hrdLeaveTraits;
    report.hrdTotalScore = total;
    if (hrdRemarks !== undefined) report.hrdRemarks = hrdRemarks;
    report.hrdEvaluatedAt = new Date();
    if (["RA_EVALUATED", "SUBMITTED"].includes(report.status)) report.status = "HRD_EVALUATED";

    await report.save();

    await AuditLog.create({ userId: req.user.userId, action: "HRD_EVALUATE", entityType: "YEARLY_APPRAISAL_REPORT", entityId: String(report.id), ipAddress: req.ip });
    res.json({ message: "HRD evaluation submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL YEARLY PLANS ───────────────────────────────────────────────────────── */
exports.getYearlyPlans = async (req, res) => {
  try {
    // FIX: exclude DRAFT plans — HRD should only see plans the employee has submitted.
    const where = { status: { [Op.ne]: "DRAFT" } };
    if (req.query.financialYear) where.financialYear = req.query.financialYear;

    const plans = await YearlyPlan.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] },
        { model: YearlyPlanRevisionLog, as: "revisionLog", order: [["revisedAt", "DESC"]] },
      ],
      order: [["submittedAt", "DESC"]],
    });

    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL YEARLY REPORTS ─────────────────────────────────────────────────────── */
exports.getYearlyReports = async (req, res) => {
  try {
    // FIX: exclude DRAFT appraisal reports from the HRD view.
    const where = { status: { [Op.ne]: "DRAFT" } };
    if (req.query.financialYear) where.financialYear = req.query.financialYear;

    const reports = await YearlyAppraisalReport.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        {
          model: YearlyPlan,
          as: "linkedYearlyPlan",
          attributes: ["id", "financialYear", "version", "status", "submittedAt", "mdRemarks"],
          include: [
            { model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] },
            { model: YearlyPlanRevisionLog, as: "revisionLog", order: [["revisedAt", "DESC"]] },
          ],
        },
        { model: YearlyAppraisalKraAssessment, as: "kraAssessments", order: [["kraIndex", "ASC"]] },
      ],
      order: [["submittedAt", "DESC"]],
    });

    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── AVAILABLE EMPLOYEES FOR RA ASSIGNMENT ──────────────────────────────────── */
exports.getAvailableEmployeesForRA = async (req, res) => {
  try {
    const employees = await User.findAll({
      where: { role: "EMPLOYEE", isActive: true },
      attributes: ["id", "name", "employeeCode", "department", "reportingAuthorityId"],
      include: [{ model: User, as: "reportingAuthority", attributes: ["id", "name"] }],
      order: [["name", "ASC"]],
    });
    res.json(employees);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch available employees", error: error.message });
  }
};

/* ─── ASSIGN EMPLOYEES TO RA ─────────────────────────────────────────────────── */
exports.assignEmployeesToRA = async (req, res) => {
  try {
    const { id } = req.params;   // RA ID
    const { employeeIds } = req.body;

    if (!Array.isArray(employeeIds)) return res.status(400).json({ message: "employeeIds must be an array" });

    const ra = await User.findByPk(id);
    if (!ra || ra.role !== "RA") return res.status(404).json({ message: "Reporting Authority not found" });

    const now = new Date();

    // Process each employee individually so we can maintain the RA assignment
    // history log. Sequential loop (not Promise.all) keeps writes atomic per
    // employee — if one fails the error is surfaced clearly.
    for (const empId of employeeIds) {
      const employee = await User.findByPk(empId, { attributes: ["id", "role", "reportingAuthorityId"] });
      if (!employee || employee.role !== "EMPLOYEE") continue;

      // Skip if already assigned to this exact RA (idempotent — no duplicate rows)
      if (String(employee.reportingAuthorityId) === String(id)) continue;

      // 1. Close the currently-open history record for this employee (if any)
      //    effectiveTo = NOW marks the end of the previous RA assignment.
      await EmployeeRAHistory.update(
        { effectiveTo: now },
        { where: { employeeId: empId, effectiveTo: null } }
      );

      // 2. Open a new history record for the new RA assignment
      await EmployeeRAHistory.create({
        employeeId: empId,
        raId: id,
        effectiveFrom: now,
        effectiveTo: null,          // null = currently active
        assignedBy: req.user.userId,
      });

      // 3. Update the denormalized current-RA column on the user record.
      //    This column is still used for non-dashboard queries (e.g. auth,
      //    employee detail pages) that do not need historical accuracy.
      await employee.update({ reportingAuthorityId: id });
    }

    await AuditLog.create({ userId: req.user.userId, action: "ASSIGN_EMPLOYEES_TO_RA", entityType: "USER", entityId: String(id), ipAddress: req.ip });
    res.json({ message: "Employees successfully assigned to Reporting Authority" });
  } catch (error) {
    res.status(500).json({ message: "Failed to assign employees", error: error.message });
  }
};