const MonthlyPlan = require("../models/MonthlyPlan");

/* ════════════════════════════════════════════════════════════════════
   HELPER — Current Financial Year
   Financial year runs April-to-March.
     • If today is April–December 2025  → FY is "2025-26"
     • If today is January–March 2026   → FY is "2025-26" (same FY)
   Returns the canonical "YYYY-YY" string, e.g. "2025-26".
════════════════════════════════════════════════════════════════════ */
function getCurrentFinancialYear() {
  const today  = new Date();
  const year   = today.getFullYear();
  const month  = today.getMonth() + 1; // 1-based

  // FY starts in April (month 4)
  const startYear = month >= 4 ? year : year - 1;
  const endYear   = (startYear + 1).toString().slice(-2); // "26"
  return `${startYear}-${endYear}`;
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
  const shortEnd  = parseInt(parts[1], 10);  // e.g. 26
  if (isNaN(startYear) || isNaN(shortEnd)) return null;

  // Reconstruct full end year: use same century as startYear
  const endYear = Math.floor(startYear / 100) * 100 + shortEnd;
  return { startYear, endYear };
}

/* ════════════════════════════════════════════════════════════════════
   MONTHLY PLAN SUBMISSION
════════════════════════════════════════════════════════════════════ */
exports.allowMonthlyPlanSubmission = (req, res, next) => {
  const today = new Date();
  const day = today.getDate();

  // ── Current-month check ──────────────────────────────────────────────────
  // The employee can only submit a plan for the current month (YYYY-MM).
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const submittedMonth = req.body.month; // expected format: "YYYY-MM"

  if (!submittedMonth) {
    return res.status(400).json({ message: "Month is required." });
  }

  if (submittedMonth !== currentMonth) {
    return res.status(403).json({
      message: `You can only submit a monthly plan for the current month (${currentMonth}). Received: ${submittedMonth}`
    });
  }
  // ────────────────────────────────────────────────────────────────────────

  // if (day < 1 || day > 7) {
  //   return res.status(403).json({
  //     message: "Monthly plan submission allowed only from 1st to 7th"
  //   });
  // }

  next();
};

/* ════════════════════════════════════════════════════════════════════
   MONTHLY ACHIEVEMENT SUBMISSION
════════════════════════════════════════════════════════════════════ */
exports.allowMonthlyAchievementSubmission = async (req, res, next) => {
  try {
    const today = new Date();
    const day = today.getDate();

    // ── Current-month check ────────────────────────────────────────────────
    // Fetch the linked plan to determine which month this achievement is for,
    // then ensure it matches the current calendar month.
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const { monthlyPlanId } = req.body;

    if (!monthlyPlanId) {
      return res.status(400).json({ message: "monthlyPlanId is required." });
    }

    const plan = await MonthlyPlan.findById(monthlyPlanId).select("month");
    if (!plan) {
      return res.status(404).json({ message: "Monthly plan not found." });
    }

    if (plan.month !== currentMonth) {
      return res.status(403).json({
        message: `You can only submit a monthly achievement for the current month (${currentMonth}). The linked plan is for: ${plan.month}`
      });
    }
    // ──────────────────────────────────────────────────────────────────────

    // if (day < 25) {
    //   return res.status(403).json({
    //     message: "Monthly achievement submission allowed from 25th onwards"
    //   });
    // }

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
  if (today > deadline) {
    return res.status(403).json({
      message: `The yearly plan submission deadline for FY ${submittedFY} has passed. Plans must be submitted by 30 April ${parsed.startYear}.`
    });
  }

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
  const windowOpen  = new Date(parsed.endYear, 2, 1, 0, 0, 0, 0);          // 1 Mar
  const windowClose = new Date(parsed.endYear, 3, 30, 23, 59, 59, 999);    // 30 Apr

  if (today < windowOpen) {
    return res.status(403).json({
      message: `Yearly appraisal submissions for FY ${submittedFY} open on 1 March ${parsed.endYear}. It is too early to submit.`
    });
  }

  if (today > windowClose) {
    return res.status(403).json({
      message: `The yearly appraisal submission deadline for FY ${submittedFY} has passed. Appraisals must be submitted by 30 April ${parsed.endYear}.`
    });
  }

  next();
};

/* ════════════════════════════════════════════════════════════════════
   YEARLY PLAN EDIT / RESUBMIT DEADLINE CHECK

   Used on  PUT  /yearly-plan/:id  and  POST /yearly-plan/:id/resubmit
   The financialYear is NOT in req.body for these routes; we load it
   from the DB using req.params.id, then apply the same April 30
   deadline as allowYearlyPlanSubmission.
════════════════════════════════════════════════════════════════════ */
const YearlyPlan = require("../models/YearlyPlan");

exports.allowYearlyPlanEdit = async (req, res, next) => {
  try {
    const today     = new Date();
    const currentFY = getCurrentFinancialYear();
    const planId    = req.params.id;

    if (!planId) {
      return res.status(400).json({ message: "Plan ID is required." });
    }

    // Load just the financialYear field from the plan
    const plan = await YearlyPlan.findById(planId).select("financialYear");
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
    if (today > deadline) {
      return res.status(403).json({
        message: `The yearly plan edit deadline for FY ${planFY} has passed. Plans must be finalised by 30 April ${parsed.startYear}.`
      });
    }

    next();
  } catch (error) {
    console.error("Yearly plan edit date middleware error:", error);
    res.status(500).json({ message: "Internal server error in date validation." });
  }
};
