// ── PERN STACK: Sequelize models loaded from index (not raw factory files)
const { MonthlyPlan, YearlyPlan } = require("../models");
const { Op } = require("sequelize");

// FISCAL YEAR FIX — shared fiscal utility is canonical source for FY logic
const { getCurrentFiscalYear } = require("../utils/fiscalUtils");

// CENTRALIZED DEADLINE CONFIG — single source of truth shared with the
// frontend via GET /api/config/deadlines. Deadlines are resolved PER ROLE
// (EMPLOYEE vs RA) so an RA's own plan/achievement — submitted via
// "Employee Mode" (asEmployee=true / selfView=true) — is held to the RA's
// deadlines, not the regular employee's, regardless of which dashboard the
// submission came from. The achievement window is bounded on both sides
// and MAY roll over into a later calendar month (see computeAchievementWindow).
const { parseDeadlineConfig, normalizeRole } = require("../controllers/configController");

// SHARED DATE HELPERS — extracted from this file into a shared module so
// configController, deadlineResolver, and raController can all import them
// without reimplementing or duplicating the logic.
const {
  getOrdinalSuffix,
  describeDeadline,
  addCalendarMonths,
  getLastDayOfMonth,
  buildDeadlineDate,
} = require("../utils/dateHelpers");

// DEADLINE RESOLVER — single source of truth for "what deadline actually
// applies right now", integrating DeadlineExtension rows from the DB.
const { getEffectiveDeadline } = require("../utils/deadlineResolver");

/* ════════════════════════════════════════════════════════════════════
   HELPER — delegates to shared fiscalUtils for consistency.
   Financial year runs April-to-March (April = month 4).
   Returns "YYYY-YY", e.g. "2025-26".
════════════════════════════════════════════════════════════════════ */
function getCurrentFinancialYear() {
  return getCurrentFiscalYear();
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — computes the concrete [windowStart, windowEnd] Date range
   for a monthly achievement, anchored to the RECORD'S OWN month
   ("YYYY-MM") rather than to "the current calendar month" — this is
   what makes the window month-flexible: it can open in the record's
   month and close in a LATER month (per achievementDeadlineMonthOffset),
   and correctly stays closed for old records once their own window has
   elapsed, with no separate "is this month too old" check needed.
════════════════════════════════════════════════════════════════════ */
function computeAchievementWindow(planMonth, config) {
  const [yearStr, monthStr] = planMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const windowStart = buildDeadlineDate(
    year, month, config.achievementStartDay, config.achievementStartMonthOffset, false
  );
  const windowEnd = buildDeadlineDate(
    year, month, config.achievementDay, config.achievementDeadlineMonthOffset, true
  );

  return { windowStart, windowEnd };
}

/* ════════════════════════════════════════════════════════════════════
   HELPER — Parse a "YYYY-YY" financial year string.
   Returns { startYear: 2025, endYear: 2026 } or null on bad input.
════════════════════════════════════════════════════════════════════ */
function parseFinancialYear(fy) {
  if (!fy || typeof fy !== "string") return null;
  const parts = fy.split("-");
  if (parts.length !== 2) return null;
  const startYear = parseInt(parts[0], 10);
  const shortEnd = parseInt(parts[1], 10);  // e.g. 26
  if (isNaN(startYear) || isNaN(shortEnd)) return null;

  // Reconstruct full end year: use same century as startYear
  const endYear = Math.floor(startYear / 100) * 100 + shortEnd;
  return { startYear, endYear };
}

/* ════════════════════════════════════════════════════════════════════
   MONTHLY PLAN SUBMISSION

   Deadline day is resolved PER ROLE (req.user.role): an RA submitting
   their own plan via Employee Mode is checked against
   MONTHLY_PLAN_DEADLINE_DAY_RA, a regular employee against
   MONTHLY_PLAN_DEADLINE_DAY_EMPLOYEE. Plans remain scoped to the
   current calendar month only (no month-rollover for plan submission —
   only the achievement window is flexible, per spec).

   EXTENSION INTEGRATION: after computing the base deadline from
   config.planDay, we call getEffectiveDeadline to see if an RA has
   granted a deadline extension for this employee's plan. If so, the
   returned effectiveDeadline replaces the raw config day for the
   "has the deadline passed?" check. The "must be the current month"
   check runs AFTER the extension check — an active extension must be
   able to unlock a month that would otherwise be rejected as
   "not the current month."
════════════════════════════════════════════════════════════════════ */
exports.allowMonthlyPlanSubmission = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user && req.user.role);
    const config = parseDeadlineConfig(role);

    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const submittedMonth = req.body.month; // expected format: "YYYY-MM"

    if (!submittedMonth) {
      return res.status(400).json({ message: "Month is required." });
    }

    // ── INDUSTRY STANDARD: Rejection Resubmission Bypass ─────────────────────
    // When an RA (or MD) rejects a plan, they create a new submission obligation
    // for the submitter. The submitter MUST be allowed to resubmit regardless of
    // whether the original month's deadline has passed — even if the month is
    // in the past. A rejection can happen weeks or months after submission.
    // Detection: an existing REJECTED plan document for this user + month.
    // Role-agnostic by design — applies equally to employees and RAs.
    //
    // PERN CHANGE: Mongoose .findOne({...}) → Sequelize .findOne({ where: {...} })
    const existingRejected = await MonthlyPlan.findOne({
      where: {
        employeeId: req.user.userId,
        month: submittedMonth,
        status: "REJECTED",
      },
    });

    if (existingRejected) {
      // Bypass ALL date checks — this is a legitimate post-rejection resubmission.
      return next();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── INDUSTRY STANDARD: Add-More-Plans Bypass ──────────────────────────────
    // Once an employee has already submitted at least one plan for a month
    // (status PENDING), the window to append additional plans to it stays
    // open for the REST OF THAT CALENDAR MONTH — independent of the original
    // MONTHLY_PLAN_DEADLINE_DAY_* cutoff, which only governs the deadline for
    // the FIRST submission. It closes at that month's end (enforced by the
    // "must be the current month" guard below, unchanged) or the moment the
    // RA/MD evaluates the plan (enforced in the controller) — whichever
    // comes first. If no plan was ever submitted for the month, this bypass
    // does not apply and the employee remains fully blocked past the normal
    // deadline until an RA grants an extension, same as today.
    const existingPending = await MonthlyPlan.findOne({
      where: {
        employeeId: req.user.userId,
        month: submittedMonth,
        status: "PENDING",
      },
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── EXTENSION CHECK: resolve effective deadline before the current-month guard ──
    // An active extension must be able to unlock a month that has already passed
    // (the "not current month" check below would reject it otherwise).
    const [submittedYear, submittedMonthNum] = submittedMonth.split("-").map(Number);

    // Base deadline: day config.planDay of the submitted month (end of day)
    const basePlanDeadline = buildDeadlineDate(
      submittedYear, submittedMonthNum, config.planDay, 0, true
    );

    const { effectiveDeadline, isExtended } = await getEffectiveDeadline({
      employeeId: req.user.userId,
      month: submittedMonthNum,
      year: submittedYear,
      type: "PLAN",
      baseDeadline: basePlanDeadline,
    });

    // If there's an active extension and we're within the extended window,
    // bypass the "must be current month" check and allow submission.
    if (isExtended && today <= effectiveDeadline) {
      return next();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Normal deadline enforcement for fresh first submissions ───────────────
    // Still applies to add-more requests too — this is what correctly closes
    // the add-more window the moment the plan's month ends.
    if (submittedMonth !== currentMonth) {
      return res.status(403).json({
        message: existingPending
          ? `The window to add more plans for ${submittedMonth} has closed — it's no longer within that month.`
          : `You can only submit a monthly plan for the current month (${currentMonth}). Received: ${submittedMonth}`
      });
    }

    // ── ROLE-AWARE DEADLINE: use effectiveDeadline (may be extended) ──────────
    // Skipped entirely for add-more requests — see the bypass comment above.
    if (!existingPending && today > effectiveDeadline) {
      const roleLabel = role === "RA" ? "As a Reporting Authority, your plans" : "Plans";
      return res.status(403).json({
        message: `Monthly plan submission deadline has passed. ${roleLabel} must be submitted by the ${config.planDay}${getOrdinalSuffix(config.planDay)} of the month.`
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    next();
  } catch (error) {
    console.error("Plan date middleware error:", error);
    res.status(500).json({ message: "Internal server error in date validation." });
  }
};

/* ════════════════════════════════════════════════════════════════════
   MONTHLY ACHIEVEMENT SUBMISSION

   Deadline window is resolved PER ROLE and is MONTH-FLEXIBLE: it is
   anchored to the linked plan's own month (plan.month), not to "the
   current calendar month" — so achievementDeadlineMonthOffset can push
   the closing date into a LATER calendar month (e.g. a July record can
   stay open through the 3rd of August for RAs) while still correctly
   closing for genuinely old records once their own window elapses.

   EXTENSION INTEGRATION: after computeAchievementWindow produces
   windowEnd, we call getEffectiveDeadline to see if an RA has granted
   a deadline extension. If so, the returned effectiveDeadline replaces
   the raw windowEnd for the "has it closed?" check. windowStart is
   untouched — extensions only ever push the closing edge later, never
   the opening edge earlier.
════════════════════════════════════════════════════════════════════ */
exports.allowMonthlyAchievementSubmission = async (req, res, next) => {
  try {
    const { monthlyPlanId } = req.body;

    if (!monthlyPlanId) {
      return res.status(400).json({ message: "monthlyPlanId is required." });
    }

    // PERN CHANGE: Mongoose .findById(id).select("month version status")
    //              → Sequelize .findByPk(id, { attributes: [...] })
    const plan = await MonthlyPlan.findByPk(monthlyPlanId, {
      attributes: ["id", "month", "version", "status", "employeeId"],
    });
    if (!plan) {
      return res.status(404).json({ message: "Monthly plan not found." });
    }

    // ── INDUSTRY STANDARD: Rejection Resubmission Bypass ─────────────────────
    // If this plan was resubmitted after RA/MD rejection (version > 1), the
    // normal achievement window does NOT apply. Role-agnostic by design.
    if (plan.version > 1) {
      // Bypass ALL date checks — post-rejection resubmission flow.
      return next();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── ROLE-AWARE, MONTH-FLEXIBLE DEADLINE WINDOW ────────────────────────────
    const role = normalizeRole(req.user && req.user.role);
    const config = parseDeadlineConfig(role);
    const { windowStart, windowEnd } = computeAchievementWindow(plan.month, config);
    const now = new Date();

    if (now < windowStart) {
      return res.status(403).json({
        message: `Monthly achievement submission for ${plan.month} opens on ${describeDeadline(config.achievementStartDay, config.achievementStartMonthOffset)}.`
      });
    }

    // ── EXTENSION CHECK: replace windowEnd with effectiveDeadline if extended ──
    const [yearStr, monthStr] = plan.month.split("-");
    const planYear = parseInt(yearStr, 10);
    const planMonthNum = parseInt(monthStr, 10);

    // Use plan.employeeId as the employee for whom to check extensions.
    // This is correct: the extension was granted to the plan owner, not the caller.
    const employeeIdForCheck = plan.employeeId || req.user.userId;

    const { effectiveDeadline } = await getEffectiveDeadline({
      employeeId: employeeIdForCheck,
      month: planMonthNum,
      year: planYear,
      type: "ACHIEVEMENT",
      baseDeadline: windowEnd,
    });

    if (now > effectiveDeadline) {
      return res.status(403).json({
        message: `Monthly achievement submission deadline for ${plan.month} has passed. Achievements must be submitted by ${describeDeadline(config.achievementDay, config.achievementDeadlineMonthOffset)}.`
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    next();
  } catch (error) {
    console.error("Achievement date middleware error:", error);
    res.status(500).json({ message: "Internal server error in date validation." });
  }
};


/* ════════════════════════════════════════════════════════════════════
   YEARLY PLAN SUBMISSION

   Rules:
   • The submitted financialYear must match the CURRENT financial year.
   • The deadline for submitting the yearly plan is 30 April of the
     FY start year (e.g. for FY "2025-26" the deadline is 30 Apr 2025).
     This means the window is: 1 April → 30 April of the start year.
════════════════════════════════════════════════════════════════════ */
exports.allowYearlyPlanSubmission = (req, res, next) => {
  const today = new Date();
  const currentFY = getCurrentFinancialYear();
  const submittedFY = req.body.financialYear; // expected: "YYYY-YY"

  // ── 1. financialYear must be provided ────────────────────────────────────
  if (!submittedFY) {
    return res.status(400).json({ message: "financialYear is required." });
  }

  // ── 2. Must be the current financial year ────────────────────────────────
  if (submittedFY !== currentFY) {
    return res.status(403).json({
      message: `You can only submit a yearly plan for the current financial year (${currentFY}). Received: ${submittedFY}.`
    });
  }

  // ── 3. Parse the FY to determine the deadline month ─────────────────────
  const parsed = parseFinancialYear(submittedFY);
  if (!parsed) {
    return res.status(400).json({
      message: `Invalid financialYear format "${submittedFY}". Expected format: "YYYY-YY" (e.g. "2025-26").`
    });
  }

  // ── 4. Deadline check: must be on or before 30 April of the start year ──
  // April = month index 3 (0-based), day 30
  const deadline = new Date(parsed.startYear, 3, 30, 23, 59, 59, 999); // Apr 30 end-of-day
  // if (today > deadline) {
  //   return res.status(403).json({
  //     message: `The yearly plan submission deadline for FY ${submittedFY} has passed. Plans must be submitted by 30 April ${parsed.startYear}.`
  //   });
  // }

  next();
};

/* ════════════════════════════════════════════════════════════════════
   YEARLY APPRAISAL REPORT SUBMISSION

   Rules:
   • The submitted financialYear must match the CURRENT financial year.
   • The window for submitting the self-appraisal report opens on
     1 March of the FY END year (i.e. after February ends) and closes
     on 30 April of the FY END year.

   Example for FY "2025-26" (ends March 2026):
     • Window open : 1 Mar 2026
     • Window close : 30 Apr 2026
════════════════════════════════════════════════════════════════════ */
exports.allowYearlyAppraisalSubmission = (req, res, next) => {
  const today = new Date();
  const currentFY = getCurrentFinancialYear();
  const submittedFY = req.body.financialYear; // expected: "YYYY-YY"

  // ── 1. financialYear must be provided ────────────────────────────────────
  if (!submittedFY) {
    return res.status(400).json({ message: "financialYear is required." });
  }

  // ── 2. Must be the current financial year ────────────────────────────────
  if (submittedFY !== currentFY) {
    return res.status(403).json({
      message: `You can only submit a yearly appraisal for the current financial year (${currentFY}). Received: ${submittedFY}.`
    });
  }

  // ── 3. Parse the FY ─────────────────────────────────────────────────────
  const parsed = parseFinancialYear(submittedFY);
  if (!parsed) {
    return res.status(400).json({
      message: `Invalid financialYear format "${submittedFY}". Expected format: "YYYY-YY" (e.g. "2025-26").`
    });
  }

  // ── 4. Window check ─────────────────────────────────────────────────────
  // Open:  1 March of the end year  (month index 2, day 1)
  // Close: 30 April of the end year (month index 3, day 30)
  const windowOpen = new Date(parsed.endYear, 2, 1, 0, 0, 0, 0); // 1 Mar
  const windowClose = new Date(parsed.endYear, 3, 30, 23, 59, 59, 999); // 30 Apr

  // if (today < windowOpen) {
  //   return res.status(403).json({
  //     message: `Yearly appraisal submissions for FY ${submittedFY} open on 1 March ${parsed.endYear}. It is too early to submit.`
  //   });
  // }

  // if (today > windowClose) {
  //   return res.status(403).json({
  //     message: `The yearly appraisal submission deadline for FY ${submittedFY} has passed. Appraisals must be submitted by 30 April ${parsed.endYear}.`
  //   });
  // }

  next();
};

/* ════════════════════════════════════════════════════════════════════
   YEARLY PLAN EDIT / RESUBMIT DEADLINE CHECK

   Used on  PUT  /yearly-plan/:id  and  POST /yearly-plan/:id/resubmit
   The financialYear is NOT in req.body for these routes; we load it
   from the DB using req.params.id, then apply the same April 30
   deadline as allowYearlyPlanSubmission.
════════════════════════════════════════════════════════════════════ */
exports.allowYearlyPlanEdit = async (req, res, next) => {
  try {
    const today = new Date();
    const currentFY = getCurrentFinancialYear();
    const planId = req.params.id;

    if (!planId) {
      return res.status(400).json({ message: "Plan ID is required." });
    }

    // PERN CHANGE: Mongoose .findById(id).select("financialYear")
    //              → Sequelize .findByPk(id, { attributes: [...] })
    const plan = await YearlyPlan.findByPk(planId, {
      attributes: ["id", "financialYear"],
    });
    if (!plan) {
      return res.status(404).json({ message: "Yearly plan not found." });
    }

    const planFY = plan.financialYear;

    // ── 1. Must match the current financial year ──────────────────────────
    if (planFY !== currentFY) {
      return res.status(403).json({
        message: `You can only edit/resubmit a yearly plan for the current financial year (${currentFY}). This plan belongs to FY ${planFY}.`
      });
    }

    // ── 2. Parse and check deadline ───────────────────────────────────────
    const parsed = parseFinancialYear(planFY);
    if (!parsed) {
      return res.status(400).json({
        message: `Could not determine deadline for financial year "${planFY}".`
      });
    }

    const deadline = new Date(parsed.startYear, 3, 30, 23, 59, 59, 999); // Apr 30
    // if (today > deadline) {
    //   return res.status(403).json({
    //     message: `The yearly plan edit deadline for FY ${planFY} has passed. Plans must be finalised by 30 April ${parsed.startYear}.`
    //   });
    // }

    next();
  } catch (error) {
    console.error("Yearly plan edit date middleware error:", error);
    res.status(500).json({ message: "Internal server error in date validation." });
  }
};