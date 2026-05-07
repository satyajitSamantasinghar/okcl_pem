/**
 * fiscalUtils.js — Shared Fiscal Year / Quarter Helpers
 *
 * Financial Year: April 1 → March 31
 *   Q1 → April, May, June       (months 4, 5, 6)
 *   Q2 → July, August, September (months 7, 8, 9)
 *   Q3 → October, November, December (months 10, 11, 12)
 *   Q4 → January, February, March   (months 1, 2, 3)
 *
 * FY Label format: "FY 2025-26"
 * Quarter+Year format: "Q1-2025" (year = start year of FY for Q1/Q2/Q3, previous year for Q4)
 */

// FISCAL YEAR FIX — Quarter month mappings (fiscal, April-based)
const QUARTER_MONTH_MAP = {
  1: [4, 5, 6],    // Q1: April, May, June
  2: [7, 8, 9],    // Q2: July, August, September
  3: [10, 11, 12], // Q3: October, November, December
  4: [1, 2, 3]     // Q4: January, February, March
};

// FISCAL YEAR FIX — Reverse map: month → quarter number
const MONTH_TO_QUARTER_MAP = {
  4: 1, 5: 1, 6: 1,   // April–June → Q1
  7: 2, 8: 2, 9: 2,   // July–September → Q2
  10: 3, 11: 3, 12: 3, // October–December → Q3
  1: 4, 2: 4, 3: 4    // January–March → Q4
};

/**
 * getFiscalYear(date)
 * Returns fiscal year label e.g. "FY 2025-26"
 * Rules:
 *   - If month >= April (4), FY = year to (year+1)
 *   - If month < April (1-3), FY = (year-1) to year
 */
function getFiscalYear(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based

  // FISCAL YEAR FIX — April is month 4, FY starts in April
  const startYear = month >= 4 ? year : year - 1;
  const endYear = (startYear + 1).toString().slice(-2); // two-digit end year
  return `FY ${startYear}-${endYear}`;
}

/**
 * getFiscalYearShort(date)
 * Returns the short "YYYY-YY" format used in DB, e.g. "2025-26"
 */
function getFiscalYearShort(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  // FISCAL YEAR FIX
  const startYear = month >= 4 ? year : year - 1;
  const endYear = (startYear + 1).toString().slice(-2);
  return `${startYear}-${endYear}`;
}

/**
 * getCurrentFiscalYear()
 * Returns "YYYY-YY" string for today, e.g. "2025-26"
 */
function getCurrentFiscalYear() {
  return getFiscalYearShort(new Date());
}

/**
 * getFiscalQuarter(date)
 * Returns Q1, Q2, Q3, or Q4 based on April-March fiscal year rules.
 * FISCAL YEAR FIX — was incorrectly using Math.ceil((month+1)/3)
 */
function getFiscalQuarter(date = new Date()) {
  const d = new Date(date);
  const month = d.getMonth() + 1; // 1-based
  const q = MONTH_TO_QUARTER_MAP[month];
  return `Q${q}`;
}

/**
 * getCurrentQuarter()
 * Returns the current fiscal quarter as "Q1", "Q2", "Q3", or "Q4"
 */
function getCurrentQuarter() {
  return getFiscalQuarter(new Date());
}

/**
 * getQuarterLabel(date)
 * Returns the full quarter+year string for use as a DB key, e.g. "Q1-2025"
 * IMPORTANT: The "year" in the label is the FISCAL YEAR START year.
 *   - Q1/Q2/Q3: use the calendar year (same as FY start year)
 *   - Q4 (Jan/Feb/Mar): use (calendar year - 1) because these months
 *     belong to the FY that started in the previous April.
 */
function getQuarterLabel(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const q = MONTH_TO_QUARTER_MAP[month];

  // FISCAL YEAR FIX — Q4 months (Jan-Mar) belong to the PREVIOUS year's FY
  const labelYear = q === 4 ? year - 1 : year;
  return `Q${q}-${labelYear}`;
}

/**
 * getFiscalYearRange(date)
 * Returns { start: Date, end: Date } for the full fiscal year containing `date`
 */
function getFiscalYearRange(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  // FISCAL YEAR FIX
  const startYear = month >= 4 ? year : year - 1;
  const start = new Date(startYear, 3, 1, 0, 0, 0, 0);       // April 1
  const end   = new Date(startYear + 1, 2, 31, 23, 59, 59, 999); // March 31
  return { start, end };
}

/**
 * getQuarterRange(date)
 * Returns { start: Date, end: Date } for the fiscal quarter containing `date`
 */
function getQuarterRange(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const q = MONTH_TO_QUARTER_MAP[month];
  const months = QUARTER_MONTH_MAP[q]; // [startMonth, midMonth, endMonth]

  const startMonth = months[0];
  const endMonth   = months[months.length - 1];

  // FISCAL YEAR FIX — Q4 months belong to calendar year 'year', but the
  // correct calendar year for the range is just 'year' for Jan–Mar
  const startYear = startMonth >= 4 ? (month >= 4 ? year : year - 1)
                                    : (month <= 3 ? year : year + 1);

  const start = new Date(startYear, startMonth - 1, 1, 0, 0, 0, 0);
  const end   = new Date(startYear, endMonth,        0, 23, 59, 59, 999); // last day of endMonth
  return { start, end };
}

/**
 * getMonthsInQuarter(quarter)
 * Returns array of month numbers for a fiscal quarter.
 * quarter: 1, 2, 3, or 4 (or "Q1", "Q2", "Q3", "Q4")
 * e.g. getMonthsInQuarter(1) → [4, 5, 6]
 */
function getMonthsInQuarter(quarter) {
  // FISCAL YEAR FIX — was returning calendar-based months
  const q = typeof quarter === 'string'
    ? parseInt(quarter.replace('Q', ''), 10)
    : parseInt(quarter, 10);
  return QUARTER_MONTH_MAP[q] || [];
}

/**
 * getQuarterMonthStrings(quarterLabel)
 * Converts e.g. "Q1-2025" into ["2025-04", "2025-05", "2025-06"]
 * FISCAL YEAR FIX — was using calendar-based monthMap { 1:[01,02,03], ... }
 */
function getQuarterMonthStrings(quarterLabel) {
  if (!quarterLabel) return null;
  const match = quarterLabel.match(/^Q(\d)[-–](\d{4})$/);
  if (!match) return null;

  const q    = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);

  // FISCAL YEAR FIX — April-based mapping
  // Q4 months (Jan-Mar) belong to the NEXT calendar year relative to label year
  const monthNums = QUARTER_MONTH_MAP[q];
  if (!monthNums) return null;

  return monthNums.map(m => {
    // Q4 months 1,2,3 are in calendar year (labelYear + 1)
    const calYear = m <= 3 ? year + 1 : year;
    return `${calYear}-${String(m).padStart(2, '0')}`;
  });
}

/**
 * buildQuarterOptions(yearsBack = 2)
 * Returns an array of quarter option strings for dropdowns,
 * in fiscal order: Q1-YYYY, Q2-YYYY, Q3-YYYY, Q4-YYYY
 * FISCAL YEAR FIX — quarters follow fiscal year, not calendar year
 */
function buildQuarterOptions(yearsBack = 2) {
  const opts = [];
  const now = new Date();
  const currentFYStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  for (let fy = currentFYStart - yearsBack; fy <= currentFYStart; fy++) {
    // Q1, Q2, Q3 are labelled with the FY start year
    opts.push(`Q1-${fy}`, `Q2-${fy}`, `Q3-${fy}`);
    // Q4 is also labelled with the FY start year (months are Jan-Mar of fy+1)
    opts.push(`Q4-${fy}`);
  }
  return opts;
}

/**
 * parseFiscalYear(fy)
 * Parses "YYYY-YY" format. Returns { startYear, endYear } or null.
 */
function parseFiscalYear(fy) {
  if (!fy || typeof fy !== 'string') return null;
  const parts = fy.split('-');
  if (parts.length !== 2) return null;
  const startYear = parseInt(parts[0], 10);
  const shortEnd  = parseInt(parts[1], 10);
  if (isNaN(startYear) || isNaN(shortEnd)) return null;
  const endYear = Math.floor(startYear / 100) * 100 + shortEnd;
  return { startYear, endYear };
}

module.exports = {
  getFiscalYear,
  getFiscalYearShort,
  getCurrentFiscalYear,
  getFiscalQuarter,
  getCurrentQuarter,
  getQuarterLabel,
  getFiscalYearRange,
  getQuarterRange,
  getMonthsInQuarter,
  getQuarterMonthStrings,
  buildQuarterOptions,
  parseFiscalYear,
  QUARTER_MONTH_MAP,
  MONTH_TO_QUARTER_MAP
};
