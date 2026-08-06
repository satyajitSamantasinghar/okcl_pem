// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE CONTROLLER  —  Shared across all roles (EMPLOYEE, RA, HRD, MD)
//
//  Design decisions:
//  • One controller for all roles — role-specific enrichment added via
//    separate helper queries, not separate controllers.
//  • passwordHash, refreshToken, reportingAuthorityId (raw FK) are NEVER
//    included in any response — always use explicit `attributes` whitelists.
//  • Only personal contact fields (email, phone) are user-editable.
//    HR-provisioned fields (role, department, designation, employeeCode,
//    reportingAuthorityId) are read-only from the user's perspective.
//  • Password change is blocked for HRMS SSO users (authProvider === "hrms").
//  • AuditLog is used for recent activity — no new table needed.
// ─────────────────────────────────────────────────────────────────────────────

const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const {
  User,
  AuditLog,
  MonthlyPlan,
  MonthlyEvaluation,
  YearlyPlan,
  YearlyAppraisalReport,
  QuarterlyEvaluation,
  EmployeeRAHistory,
} = require("../models");

// ─── Safe user attributes — never expose passwordHash / refreshToken ──────────
const SAFE_USER_ATTRS = [
  "id", "employeeCode", "name", "email", "phone",
  "role", "department", "designation",
  "authProvider", "isActive", "createdAt", "updatedAt",
];

// ─── Reporting authority attributes (only public identity fields) ─────────────
const RA_ATTRS = ["id", "name", "designation", "employeeCode", "department"];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/me
// Returns the authenticated user's full profile with role-specific stats.
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    // ── Fetch base user with reporting authority joined ───────────────────────
    const user = await User.findByPk(userId, {
      attributes: SAFE_USER_ATTRS,
      include: [
        {
          model: User,
          as: "reportingAuthority",
          attributes: RA_ATTRS,
          required: false,
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // ── RA assignment history — available for ALL roles, not just EMPLOYEE ────
    // Records are ordered newest-first so the UI can distinguish current vs past.
    // effectiveTo = null  → currently assigned RA (matches User.reportingAuthority)
    // effectiveTo = date  → past RA, assignment closed on that date
    // assignedByUser join shows which HRD admin made the change (useful audit info)
    const raHistory = await EmployeeRAHistory.findAll({
      where: { employeeId: userId },
      order: [["effectiveFrom", "DESC"]],
      include: [
        {
          model: User,
          as: "ra",
          attributes: RA_ATTRS,
          required: true,
        },
        {
          model: User,
          as: "assignedByUser",
          attributes: ["id", "name", "designation"],
          required: false,          // assignedBy may be null for legacy / seeded records
        },
      ],
      attributes: ["id", "effectiveFrom", "effectiveTo"],
    });

    // ── Role-specific stats ───────────────────────────────────────────────────
    let roleStats = {};

    if (role === "EMPLOYEE") {
      const [monthlyPlansCount, yearlyPlanStatus, quarterlyCount] = await Promise.all([
        MonthlyPlan.count({ where: { employeeId: userId } }),
        YearlyPlan.findOne({
          where: { employeeId: userId },
          attributes: ["id", "financialYear", "status"],
          order: [["createdAt", "DESC"]],
        }),
        QuarterlyEvaluation.count({ where: { employeeId: userId } }),
      ]);
      roleStats = {
        monthlyPlansSubmitted: monthlyPlansCount,
        latestYearlyPlan: yearlyPlanStatus || null,
        quarterlyEvalCount: quarterlyCount,
      };
    }

    if (role === "RA") {
      // Direct reports count = subordinates currently assigned (effectiveTo IS NULL)
      const [directReportsCount, pendingEvalCount] = await Promise.all([
        EmployeeRAHistory.count({
          where: { raId: userId, effectiveTo: null },
        }),
        MonthlyEvaluation.count({
          where: { raId: userId, status: "PENDING" },
        }),
      ]);
      roleStats = {
        directReportsCount,
        pendingEvaluations: pendingEvalCount,
      };
    }

    if (role === "HRD") {
      const [totalEmployees, totalRAs, pendingAppraisals] = await Promise.all([
        User.count({ where: { role: "EMPLOYEE", isActive: true } }),
        User.count({ where: { role: "RA", isActive: true } }),
        YearlyAppraisalReport.count({ where: { status: "SUBMITTED" } }),
      ]);
      roleStats = {
        totalEmployees,
        totalRAs,
        pendingAppraisals,
      };
    }

    if (role === "MD") {
      const [pendingYearlyPlans, pendingAppraisals] = await Promise.all([
        YearlyPlan.count({ where: { status: "PENDING" } }),
        YearlyAppraisalReport.count({ where: { status: "HRD_EVALUATED" } }),
      ]);
      roleStats = {
        pendingYearlyPlanApprovals: pendingYearlyPlans,
        pendingAppraisalReviews: pendingAppraisals,
      };
    }

    // Shape the history for the frontend:
    // { current: {...ra}, history: [{ra, from, to, assignedBy}] }
    const raHistoryFormatted = raHistory.map((h) => ({
      ra: h.ra,
      effectiveFrom: h.effectiveFrom,
      effectiveTo: h.effectiveTo,       // null = still active
      isCurrent: h.effectiveTo === null,
      assignedBy: h.assignedByUser || null,
    }));

    return res.json({
      ...user.toJSON(),
      roleStats,
      raHistory: raHistoryFormatted,
    });
  } catch (error) {
    console.error("[Profile] getMyProfile error:", error.message);
    return res.status(500).json({ message: "Failed to load profile." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/profile/me
// Updates ONLY whitelisted personal contact fields.
// HR-provisioned fields are silently ignored (never returned as errors —
// the frontend simply shouldn't offer those fields for editing).
// ─────────────────────────────────────────────────────────────────────────────
exports.updateMyProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    // ── Strict whitelist — only these two fields are user-editable ────────────
    const EDITABLE_FIELDS = ["email", "phone"];
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field] === "" ? null : req.body[field].trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields provided for update." });
    }

    // ── Email uniqueness check (skip if unchanged) ────────────────────────────
    if (updates.email) {
      const emailConflict = await User.findOne({
        where: { email: updates.email, id: { [Op.ne]: userId } },
        attributes: ["id"],
      });
      if (emailConflict) {
        return res.status(409).json({
          message: "This email address is already in use by another account.",
        });
      }
    }

    await User.update(updates, { where: { id: userId } });

    // ── Return updated profile (same shape as getMyProfile) ───────────────────
    const updated = await User.findByPk(userId, {
      attributes: SAFE_USER_ATTRS,
      include: [
        {
          model: User,
          as: "reportingAuthority",
          attributes: RA_ATTRS,
          required: false,
        },
      ],
    });

    return res.json({
      message: "Profile updated successfully.",
      user: updated,
    });
  } catch (error) {
    console.error("[Profile] updateMyProfile error:", error.message);
    return res.status(500).json({ message: "Failed to update profile." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/profile/me/password
// Changes password for LOCAL users only.
// HRMS SSO users are redirected to the HRMS portal (authProvider === "hrms").
// ─────────────────────────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Both currentPassword and newPassword are required.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters.",
      });
    }

    // Fetch including authProvider and passwordHash (not in SAFE_USER_ATTRS)
    const user = await User.findByPk(userId, {
      attributes: ["id", "authProvider", "passwordHash"],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // ── Block SSO users — they don't manage passwords here ────────────────────
    if (user.authProvider === "hrms") {
      return res.status(403).json({
        message:
          "Your password is managed by the HRMS portal. " +
          "Please use the HRMS system to change your password.",
        redirectToHRMS: true,
      });
    }

    // ── Verify current password ───────────────────────────────────────────────
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    // ── Prevent reuse of current password ────────────────────────────────────
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      return res.status(400).json({
        message: "New password must be different from your current password.",
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await User.update({ passwordHash: newHash }, { where: { id: userId } });

    return res.json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("[Profile] changePassword error:", error.message);
    return res.status(500).json({ message: "Failed to change password." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/me/activity
// Returns the last N audit log entries for the authenticated user.
// Paginated via ?limit=10&offset=0 query params.
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyActivity = async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
    const offset = parseInt(req.query.offset || "0", 10);

    const { count, rows } = await AuditLog.findAndCountAll({
      where: { userId },
      order: [["timestamp", "DESC"]],
      limit,
      offset,
      attributes: ["id", "action", "entityType", "entityId", "ipAddress", "timestamp"],
    });

    // ── Humanize action labels for the UI ────────────────────────────────────
    const ACTION_LABELS = {
      SUBMIT: "Submitted",
      DRAFT_SAVE: "Saved draft",
      DRAFT_UPDATE: "Updated draft",
      RESUBMIT: "Resubmitted",
      EVALUATE: "Evaluated",
      APPROVE: "Approved",
      REJECT: "Rejected",
    };

    const ENTITY_LABELS = {
      MONTHLY_PLAN: "Monthly Plan",
      MONTHLY_ACHIEVEMENT: "Monthly Progress",
      YEARLY_PLAN: "Yearly Plan",
      YEARLY_APPRAISAL_REPORT: "Yearly Appraisal",
    };

    const formatted = rows.map((log) => ({
      id: log.id,
      action: ACTION_LABELS[log.action] || log.action,
      entity: ENTITY_LABELS[log.entityType] || log.entityType,
      entityId: log.entityId,
      ipAddress: log.ipAddress,
      createdAt: log.timestamp,   // rename to createdAt for a consistent API shape
    }));

    return res.json({
      total: count,
      limit,
      offset,
      activity: formatted,
    });
  } catch (error) {
    console.error("[Profile] getMyActivity error:", error.message);
    return res.status(500).json({ message: "Failed to load activity." });
  }
};