/**
 * fiscalUtils.js — Frontend Fiscal Year / Quarter Helpers
 *
 * Financial Year: April 1 → March 31
 *   Q1 → April, May, June         (months 4, 5, 6)
 *   Q2 → July, August, September  (months 7, 8, 9)
 *   Q3 → October, November, December (months 10, 11, 12)
 *   Q4 → January, February, March (months 1, 2, 3)
 *
 * FY Label format: "FY 2025-26"
 * Quarter+Year format: "Q1-2025"
 */

// FISCAL YEAR FIX — Quarter → months mapping (1-based month numbers)
export const QUARTER_MONTH_MAP = {
  1: [4, 5, 6],      // Q1: April, May, June
  2: [7, 8, 9],      // Q2: July, August, September
  3: [10, 11, 12],   // Q3: October, November, December
  4: [1, 2, 3]       // Q4: January, February, March
};

// FISCAL YEAR FIX — Month → quarter mapping
export const MONTH_TO_QUARTER_MAP = {
  4: 1, 5: 1, 6: 1,
  7: 2, 8: 2, 9: 2,
  10: 3, 11: 3, 12: 3,
  1: 4, 2: 4, 3: 4
};

/**
 * getFiscalYear(date)
 * Returns "FY YYYY-YY" label, e.g. "FY 2025-26"
 * FISCAL YEAR FIX — months < April belong to previous FY
 */
export function getFiscalYear(date = new Date()) {
  const d = new Date(date);
  const year  = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based
  const startYear = month >= 4 ? year : year - 1;
  const endYear   = (startYear + 1).toString().slice(-2);
  return `FY ${startYear}-${endYear}`;
}

/**
 * getFiscalYearShort(date)
 * Returns "YYYY-YY" format used in DB, e.g. "2025-26"
 */
export function getFiscalYearShort(date = new Date()) {
  const d = new Date(date);
  const year  = d.getFullYear();
  const month = d.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const endYear   = (startYear + 1).toString().slice(-2);
  return `${startYear}-${endYear}`;
}

/**
 * getCurrentFiscalYear()
 * Returns current "YYYY-YY" financial year string
 */
export function getCurrentFiscalYear() {
  return getFiscalYearShort(new Date());
}

/**
 * getFiscalQuarter(date)
 * Returns "Q1" | "Q2" | "Q3" | "Q4"
 * FISCAL YEAR FIX — was Math.ceil((month+1)/3), wrong for April-based FY
 */
export function getFiscalQuarter(date = new Date()) {
  const d = new Date(date);
  const month = d.getMonth() + 1;
  const q = MONTH_TO_QUARTER_MAP[month];
  return `Q${q}`;
}

/**
 * getCurrentQuarter()
 * Returns fiscal quarter for today, e.g. "Q1"
 */
export function getCurrentQuarter() {
  return getFiscalQuarter(new Date());
}

/**
 * getQuarterLabel(date)
 * Returns "Q1-2025" style label.
 * FISCAL YEAR FIX — Q4 (Jan-Mar) belongs to previous year's FY start
 */
export function getQuarterLabel(date = new Date()) {
  const d = new Date(date);
  const year  = d.getFullYear();
  const month = d.getMonth() + 1;
  const q = MONTH_TO_QUARTER_MAP[month];
  // Q4 months (Jan-Mar) belong to the FY that started the previous April
  const labelYear = q === 4 ? year - 1 : year;
  return `Q${q}-${labelYear}`;
}

/**
 * getCurrentQuarterLabel()
 * Returns current fiscal quarter label e.g. "Q1-2025"
 */
export function getCurrentQuarterLabel() {
  return getQuarterLabel(new Date());
}

/**
 * getMonthsInQuarter(quarter)
 * quarter: 1-4 or "Q1"-"Q4"
 * Returns array of month numbers e.g. [4, 5, 6]
 * FISCAL YEAR FIX — was calendar-based
 */
export function getMonthsInQuarter(quarter) {
  const q = typeof quarter === 'string'
    ? parseInt(quarter.replace('Q', ''), 10)
    : parseInt(quarter, 10);
  return QUARTER_MONTH_MAP[q] || [];
}

/**
 * getFiscalMonthOrder()
 * Returns months in fiscal year order (April → March)
 * FISCAL YEAR FIX — was January → December
 */
export function getFiscalMonthOrder() {
  return [
    { value: '04', label: 'April',     num: 4  },
    { value: '05', label: 'May',       num: 5  },
    { value: '06', label: 'June',      num: 6  },
    { value: '07', label: 'July',      num: 7  },
    { value: '08', label: 'August',    num: 8  },
    { value: '09', label: 'September', num: 9  },
    { value: '10', label: 'October',   num: 10 },
    { value: '11', label: 'November',  num: 11 },
    { value: '12', label: 'December',  num: 12 },
    { value: '01', label: 'January',   num: 1  },
    { value: '02', label: 'February',  num: 2  },
    { value: '03', label: 'March',     num: 3  },
  ];
}

/**
 * buildQuarterOptions(yearsBack = 2)
 * Returns quarter option strings for dropdowns in fiscal order.
 * FISCAL YEAR FIX — quarters follow April-March fiscal year
 */
export function buildQuarterOptions(yearsBack = 2) {
  const opts = [];
  const now = new Date();
  const currentFYStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  for (let fy = currentFYStart - yearsBack; fy <= currentFYStart; fy++) {
    opts.push(`Q1-${fy}`, `Q2-${fy}`, `Q3-${fy}`, `Q4-${fy}`);
  }
  return opts;
}

/**
 * getFiscalYearRange(date)
 * Returns { start: Date, end: Date } for the full fiscal year
 */
export function getFiscalYearRange(date = new Date()) {
  const d = new Date(date);
  const year  = d.getFullYear();
  const month = d.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const start = new Date(startYear,     3, 1,  0,  0,  0,   0); // April 1
  const end   = new Date(startYear + 1, 2, 31, 23, 59, 59, 999); // March 31
  return { start, end };
}

/**
 * getQuarterRange(date)
 * Returns { start: Date, end: Date } for the fiscal quarter of the given date
 */
export function getQuarterRange(date = new Date()) {
  const d = new Date(date);
  const year  = d.getFullYear();
  const month = d.getMonth() + 1;
  const q = MONTH_TO_QUARTER_MAP[month];
  const months = QUARTER_MONTH_MAP[q];

  const startMonthNum = months[0];
  const endMonthNum   = months[months.length - 1];

  // Determine the calendar year for the start month
  let startCalYear;
  if (q === 4) {
    // Q4: Jan-Mar belong to year (they are at start of calendar year)
    startCalYear = year;
  } else {
    startCalYear = year;
  }

  const start = new Date(startCalYear, startMonthNum - 1, 1,  0,  0,  0,   0);
  const end   = new Date(startCalYear, endMonthNum,       0, 23, 59, 59, 999); // last day
  return { start, end };
}

/**
 * getQuarterMonthStrings(quarterLabel)
 * "Q1-2025" → ["2025-04", "2025-05", "2025-06"]
 * "Q4-2025" → ["2026-01", "2026-02", "2026-03"]
 * FISCAL YEAR FIX — Q4 months are in the NEXT calendar year
 */
export function getQuarterMonthStrings(quarterLabel) {
  if (!quarterLabel) return [];
  const match = quarterLabel.match(/^Q(\d)[-–](\d{4})$/);
  if (!match) return [];

  const q    = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  const monthNums = QUARTER_MONTH_MAP[q];
  if (!monthNums) return [];

  return monthNums.map(m => {
    // Q4 months (1, 2, 3) are in the next calendar year relative to label year
    const calYear = m <= 3 ? year + 1 : year;
    return `${calYear}-${String(m).padStart(2, '0')}`;
  });
}

/**
 * formatFiscalYear(fy)
 * "2025-26" → "FY 2025-26"
 */
export function formatFiscalYear(fy) {
  if (!fy) return '';
  if (fy.startsWith('FY ')) return fy;
  return `FY ${fy}`;
}

/**
 * formatQuarterLabel(quarterLabel)
 * "Q1-2025" → "Q1 · FY 2025-26"
 */
export function formatQuarterLabel(quarterLabel) {
  if (!quarterLabel) return '';
  const match = quarterLabel.match(/^Q(\d)[-–](\d{4})$/);
  if (!match) return quarterLabel;
  const q    = match[1];
  const year = parseInt(match[2], 10);
  const endYear = (year + 1).toString().slice(-2);
  return `Q${q} · FY ${year}-${endYear}`;
}
