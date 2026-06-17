// ─────────────────────────────────────────────────────────────────────────────
//  AUTH CONTROLLER  —  Mongoose → Sequelize conversion
//
//  CHANGES:
//  1. Single destructured import from '../models' instead of per-file requires
//  2. User.findOne({ email })           → User.findOne({ where: { email } })
//  3. User.findById(id)                 → User.findByPk(id)
//  4. user._id                          → user.id
//  5. User.findByIdAndUpdate(id, data)  → User.update(data, { where: { id } })
//  6. user.save()                       works the same on Sequelize instances
// ─────────────────────────────────────────────────────────────────────────────

const { User } = require("../models");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

/* ─── REGISTER ─────────────────────────────────────────────────────────────── */
exports.register = async (req, res) => {
  try {
    const {
      employeeCode, name, email, password,
      role, department, reportingAuthorityId
    } = req.body;

    const passwordHash = await bcrypt.hash(password, 10);

    // CHANGE: User.create() works the same; field names match Sequelize model
    await User.create({
      employeeCode,
      name,
      email,
      passwordHash,
      role,
      department,
      reportingAuthorityId: reportingAuthorityId || null,
    });

    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── LOGIN ────────────────────────────────────────────────────────────────── */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // CHANGE: findOne needs a 'where' clause in Sequelize
    const user = await User.findOne({ where: { email } });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // CHANGE: user._id  →  user.id  (PostgreSQL uses UUID primary key 'id')
    const accessToken = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    // CHANGE: instance.save() works exactly the same in Sequelize
    user.refreshToken = refreshToken;
    await user.save();

    res.json({ accessToken, refreshToken, role: user.role, name: user.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── REFRESH ACCESS TOKEN ──────────────────────────────────────────────────── */
exports.refreshAccessToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token required" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // CHANGE: findById(id)  →  findByPk(id)
    const user = await User.findByPk(decoded.userId);

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    const newAccessToken = jwt.sign(
      { userId: user.id, role: user.role },   // CHANGE: user._id → user.id
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(403).json({ message: "Invalid refresh token" });
  }
};

/* ─── LOGOUT ────────────────────────────────────────────────────────────────── */
exports.logout = async (req, res) => {
  try {
    const userId = req.user.userId;

    // CHANGE: findByIdAndUpdate()  →  Model.update(data, { where: { id } })
    // Sequelize has no findByIdAndUpdate(); update() targets rows via WHERE clause
    await User.update({ refreshToken: null }, { where: { id: userId } });

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: "Logout failed" });
  }
};

/* ─── HRMS SSO ──────────────────────────────────────────────────────────────────
 *  Called when an employee is redirected from the HRMS portal with a Base64
 *  token in the URL: /login?token=<BASE64>
 *
 *  Token fields used (others like py, emcd, fycd, pycd are ignored):
 *    emp_code  → employeeCode       (primary link key)
 *    nm        → name
 *    desg      → department
 *    ra_id  → reportingAuthorityId  (looked up by employeeCode in local DB)
 *    ishod     → role derivation:
 *                  ""  / null  → "EMPLOYEE" (regular employee)
 *                  "1"         → "RA"       (person is a Reporting Authority)
 *                  existing HRD / MD roles in DB are never overwritten by SSO
 *    yractv    → isActive  ("1" = active)
 *    time      → token-issue Unix timestamp (used for expiry check)
 *
 *  Security (Phase 1 — expiry-only):
 *    Rejects tokens older than SSO_TOKEN_MAX_AGE seconds (default: 300 = 5 min).
 *    Phase 2 will add HRMS server-side verification or HMAC signature check.
 * ────────────────────────────────────────────────────────────────────────────── */
exports.hrmsSSO = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "SSO token is required" });
    }

    // ── 1. Decode the Base64 token ────────────────────────────────────────────
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    } catch {
      return res.status(400).json({ message: "Malformed SSO token" });
    }

    // ── 2. Validate required fields ───────────────────────────────────────────
    if (!decoded.emp_code || !decoded.time) {
      return res.status(400).json({ message: "SSO token is missing required fields" });
    }

    // ── 3. Expiry check — reject tokens older than SSO_TOKEN_MAX_AGE seconds ──
    const MAX_AGE = parseInt(process.env.SSO_TOKEN_MAX_AGE || "300", 10); // default 5 min
    const tokenAgeSeconds = Math.floor(Date.now() / 1000) - decoded.time;
    if (tokenAgeSeconds < 0 || tokenAgeSeconds > MAX_AGE) {
      return res.status(401).json({ message: "SSO token has expired. Please log in again from HRMS." });
    }

    // ── 4. Derive role from emp_code and ishod ──────────────────────────────
    //  emp_code === "HRD"     → role "HRD"      (HR Director — special emp_code)
    //  emp_code === "1686011" → role "MD"       (Managing Director)
    //  ishod === "-1"         → role "EMPLOYEE" (regular employee)
    //  ishod = any other val  → role "RA"       (Reporting Authority, e.g. "1267")
    let derivedRole;
    if (decoded.emp_code === "HRD") {
      derivedRole = "HRD";
    } else if (decoded.emp_code === "1686011") {
      derivedRole = "MD";
    } else {
      const ishod = String(decoded.ishod ?? "");
      derivedRole = ishod === "-1" ? "EMPLOYEE" : "RA";
    }

    // ── 5. Resolve Reporting Authority UUID from ra_id ─────────────────────
    //  ra_id holds the HRMS location/employee code of the employee's manager.
    //  We look up the RA in our local users table; if they haven't logged in yet
    //  (not provisioned), reportingAuthorityId stays null and will be resolved
    //  on the RA's next SSO login when their record gets created.
    let reportingAuthorityId = null;
    if (decoded.ra_id) {
      const ra = await User.findOne({
        where: { employeeCode: String(decoded.ra_id) },
        attributes: ["id"],
      });
      if (ra) reportingAuthorityId = ra.id;
    }

    // ── 6. JIT Provisioning — find or create user by employeeCode ─────────────
    const isActive = decoded.yractv === "1" || decoded.yractv === 1;

    const [user, created] = await User.findOrCreate({
      where: { employeeCode: decoded.emp_code },
      defaults: {
        name:                 (decoded.nm || "").trim(),
        email:                decoded.ismail     || null,
        role:                 derivedRole,
        department:           decoded.department || null,  // token field: department
        designation:          decoded.designation || null, // token field: designation
        phone:                decoded.phone      || null,  // token field: phone
        reportingAuthorityId,
        isActive,
        authProvider: "hrms",
      },
    });

    if (!created) {
      // ── 7. Sync latest HRMS data on every login ───────────────────────────────
      //  Always refresh these fields from the token so our DB mirrors HRMS.
      //  Exception: HRD and MD roles are now derived from emp_code itself,
      //  but the guard still protects any manually-set HRD/MD in the DB from
      //  being overwritten when derivedRole is EMPLOYEE or RA.
      const isPrivilegedRole = user.role === "HRD" || user.role === "MD";

      user.name        = (decoded.nm || "").trim();
      user.email       = decoded.ismail      || user.email;       // keep existing if omitted
      user.department  = decoded.department  || user.department;  // token field: department
      user.designation = decoded.designation || user.designation; // token field: designation
      user.phone       = decoded.phone       || user.phone;       // token field: phone
      user.reportingAuthorityId = reportingAuthorityId ?? user.reportingAuthorityId;
      user.isActive    = isActive;

      // Only update role if the user is NOT a manually-assigned HRD or MD
      if (!isPrivilegedRole) {
        user.role = derivedRole;
      }

      await user.save();
    }

    // ── 8. Guard — block deactivated users ────────────────────────────────────
    if (!user.isActive) {
      return res.status(403).json({ message: "Your account has been deactivated. Contact HR." });
    }

    // ── 9. Issue local JWT session tokens ────────────────────────────────────
    const accessToken = jwt.sign(
      { userId: user.id, role: user.role, employeeCode: user.employeeCode },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "1d" }
    );

    user.refreshToken = refreshToken;
    await user.save();

    return res.status(200).json({
      accessToken,
      refreshToken,
      role: user.role,
      name: user.name,
    });

  } catch (error) {
    console.error("[HRMS SSO Error]", error.message);
    return res.status(500).json({ message: "SSO authentication failed. Please try again." });
  }
};
