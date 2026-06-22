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

const { User, EmployeeRAHistory } = require("../models");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

/* ─── REGISTER ─────────────────────────────────────────────────────────────── */
exports.register = async (req, res) => {
  try {
    const {
      employeeCode, name, email, password,
      role, department, reportingAuthorityId
    } = req.body;

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      employeeCode,
      name,
      email,
      passwordHash,
      role,
      department,
      reportingAuthorityId: reportingAuthorityId || null,
    });

    // Seed the initial RA assignment history row when an RA is set at creation
    if (reportingAuthorityId) {
      await EmployeeRAHistory.create({
        employeeId:    newUser.id,
        raId:          reportingAuthorityId,
        effectiveFrom: newUser.createdAt,
        effectiveTo:   null,
        assignedBy:    null,  // system/admin — no req.user in this context
      });
    }

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

/* ─── Decrypt HRMS KRA Token ─────────────────────────────────────────────────
 *  Token format (set by HRMS PHP backend):
 *    Base64( IV[16 bytes] + HMAC-SHA256[32 bytes] + AES-256-CBC-encrypted-JSON )
 *
 *  Key derivation:  SHA-256( KRA_SECRET_KEY )   (raw binary, 32 bytes)
 *  HMAC is computed over the encrypted payload only (not IV).
 *  Decrypted payload is a JSON string with the user's HRMS profile.
 * ──────────────────────────────────────────────────────────────────────────── */
function decryptKraToken(token) {
  // 1. URL-decode (handles double-encoding: %2F → /, %2B → +)
  const cleanToken = decodeURIComponent(token);

  // 2. Derive key: SHA-256 of the secret (raw binary — matches PHP hash('sha256', key, true))
  const secretKey = process.env.KRA_SECRET_KEY;
  if (!secretKey) throw new Error("KRA_SECRET_KEY is not set in environment");
  const key = crypto.createHash("sha256").update(secretKey).digest();

  // 3. Base64-decode into raw bytes
  const data = Buffer.from(cleanToken, "base64");
  if (data.length < 49) throw new Error("Token too short");

  // 4. Split: IV (16 bytes) | HMAC (32 bytes) | encrypted payload (rest)
  const iv        = data.subarray(0, 16);
  const hmacHash  = data.subarray(16, 48);
  const encrypted = data.subarray(48);

  // 5. Verify HMAC-SHA256 (matches PHP hash_hmac('sha256', $encrypted, $key, true))
  const check = crypto.createHmac("sha256", key).update(encrypted).digest();
  if (!crypto.timingSafeEqual(hmacHash, check)) {
    throw new Error("Invalid Token — HMAC verification failed");
  }

  // 6. AES-256-CBC decrypt (matches PHP openssl_decrypt with OPENSSL_RAW_DATA)
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  // 7. Parse JSON
  return JSON.parse(decrypted.toString("utf-8"));
}

/* ─── HRMS SSO ──────────────────────────────────────────────────────────────────
 *  Called when an employee is redirected from the HRMS portal with an encrypted
 *  token in the URL: /login?token=<AES-256-CBC-ENCRYPTED-BASE64>
 *
 *  Token fields used (others like branch, fycd, pycd are ignored):
 *    emp_code      → employeeCode       (primary link key)
 *    nm            → name
 *    is_dep        → department
 *    desg          → designation
 *    phone_number  → phone
 *    ismail        → email
 *    ra_id         → reportingAuthorityId  (looked up by employeeCode in local DB)
 *    ishod         → role derivation:
 *                      "" / null / "-1"  → "EMPLOYEE"
 *                      any other value    → "RA"
 *    emp_code "HRD"     → role "HRD"
 *    emp_code "1686011" → role "MD"
 *    yractv        → isActive  ("1" = active)
 *    time          → token-issue Unix timestamp (used for expiry check)
 *
 *  Security:
 *    1. AES-256-CBC decryption with HMAC-SHA256 integrity verification
 *    2. Token expiry check (SSO_TOKEN_MAX_AGE seconds, default 1 hour)
 * ────────────────────────────────────────────────────────────────────────────── */
exports.hrmsSSO = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "SSO token is required" });
    }

    // ── 1. Decrypt the AES-256-CBC encrypted token ──────────────────────────
    let decoded;
    try {
      decoded = decryptKraToken(token);
    } catch (err) {
      console.error("[HRMS SSO] Token decryption failed:", err.message);
      return res.status(400).json({ message: "Invalid or tampered SSO token" });
    }

    // ── 2. Validate required fields ───────────────────────────────────────────
    if (!decoded.emp_code || !decoded.time) {
      return res.status(400).json({ message: "SSO token is missing required fields" });
    }

    // ── 3. Expiry check — reject tokens older than SSO_TOKEN_MAX_AGE seconds ──
    const MAX_AGE = parseInt(process.env.SSO_TOKEN_MAX_AGE || "3600", 10); // default 1 hour
    const tokenAgeSeconds = Math.floor(Date.now() / 1000) - decoded.time;
    if (tokenAgeSeconds < 0 || tokenAgeSeconds > MAX_AGE) {
      return res.status(401).json({ message: "SSO token has expired. Please log in again from HRMS." });
    }

    // ── 4. Derive role from emp_code and ishod ──────────────────────────────
    //  emp_code === "HRD"                  → role "HRD"
    //  emp_code === "1686011"              → role "MD"
    //  ishod === "" or "-1" (EMPLOYEE)    → role "EMPLOYEE"
    //  ishod = any positive number string  → role "RA" (e.g. "1267", "1686005")
    let derivedRole;
    if (decoded.emp_code === "HRD") {
      derivedRole = "HRD";
    } else if (decoded.emp_code === "1686011") {
      derivedRole = "MD";
    } else {
      const ishod = String(decoded.ishod ?? "");
      derivedRole = (ishod === "" || ishod === "-1") ? "EMPLOYEE" : "RA";
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

    // Pre-check: if the HRMS token carries an email that already belongs to a
    // DIFFERENT employee code in our DB, this is a data conflict — most likely
    // the HRMS accidentally changed the employee's emp_code.
    // Industry-standard approach: reject the login with a clear 409 Conflict
    // so the HRD/admin knows exactly what to fix, rather than silently
    // corrupting data or logging the user in with the wrong account.
    const incomingEmail = decoded.ismail || null;
    if (incomingEmail) {
      const emailConflict = await User.findOne({
        where: { email: incomingEmail },
        attributes: ["id", "employeeCode"],
      });
      if (emailConflict && String(emailConflict.employeeCode) !== String(decoded.emp_code)) {
        console.warn(
          `[HRMS SSO] 409 Conflict: email "${incomingEmail}" is already registered ` +
          `under emp_code "${emailConflict.employeeCode}" but HRMS token carries ` +
          `emp_code "${decoded.emp_code}". Login blocked.`
        );
        return res.status(409).json({
          message:
            `Login failed: the email "${incomingEmail}" is already registered ` +
            `under employee code "${emailConflict.employeeCode}". ` +
            `The HRMS may have assigned a different employee code to this account. ` +
            `Please contact HRD to resolve the data conflict before logging in.`,
        });
      }
    }

    const [user, created] = await User.findOrCreate({
      where: { employeeCode: decoded.emp_code },
      defaults: {
        name: (decoded.nm || "").trim(),
        email: incomingEmail,
        role: derivedRole,
        department: decoded.is_dep || null,  // token field: department
        designation: decoded.desg || null, // token field: designation
        phone: decoded.phone_number || null,  // token field: phone
        reportingAuthorityId,
        isActive,
        authProvider: "hrms",
      },
    });

    // ── 6b. Seed first RA history row for brand-new SSO users ────────────────
    //  The server.js backfill handles pre-existing users, but new users
    //  provisioned via SSO after the history table exists need their first row
    //  created inline here so the dashboard is immediately accurate.
    //  Wrapped in try/catch so a missing history table never blocks login.
    if (created && reportingAuthorityId && ["EMPLOYEE", "RA"].includes(derivedRole)) {
      try {
        await EmployeeRAHistory.create({
          employeeId:    user.id,
          raId:          reportingAuthorityId,
          effectiveFrom: user.createdAt,
          effectiveTo:   null,
          assignedBy:    null,   // HRMS-driven — no admin actor
        });
      } catch (histErr) {
        console.error("[HRMS SSO] Failed to seed RA history for new user:", histErr.message);
      }
    }

    if (!created) {
      // ── 7. Sync latest HRMS data on every login ───────────────────────────────
      //  Always refresh these fields from the token so our DB mirrors HRMS.
      //  Exception: HRD and MD roles are now derived from emp_code itself,
      //  but the guard still protects any manually-set HRD/MD in the DB from
      //  being overwritten when derivedRole is EMPLOYEE or RA.
      const isPrivilegedRole = user.role === "HRD" || user.role === "MD";

      user.name = (decoded.nm || "").trim();

      // Update email from HRMS token if it has changed.
      // If the incoming email is already owned by a DIFFERENT user, it means
      // there is a real data conflict (e.g., HRMS changed this user's emp_code)
      // → block the login with a clear 409 Conflict instead of silently skipping.
      if (incomingEmail && incomingEmail !== user.email) {
        const emailOwner = await User.findOne({
          where: { email: incomingEmail },
          attributes: ["id", "employeeCode"],
        });
        if (emailOwner && emailOwner.id !== user.id) {
          console.warn(
            `[HRMS SSO] 409 Conflict: email "${incomingEmail}" already belongs to ` +
            `emp_code "${emailOwner.employeeCode}" — cannot update emp "${user.employeeCode}".`
          );
          return res.status(409).json({
            message:
              `Login failed: the email "${incomingEmail}" is already registered ` +
              `under employee code "${emailOwner.employeeCode}". ` +
              `The HRMS may have assigned a different employee code to this account. ` +
              `Please contact HRD to resolve the data conflict before logging in.`,
          });
        }
        user.email = incomingEmail;
      }
      user.department = decoded.is_dep || user.department;  // token field: department
      user.designation = decoded.desg || user.designation; // token field: designation
      user.phone = decoded.phone_number || user.phone;       // token field: phone

      // ── Track RA changes in history ──────────────────────────────────────────
      //  If the HRMS token carries a different RA than what we have on record,
      //  close the current history row and open a new one.
      //  Wrapped in try/catch so a missing history table never blocks login.
      const prevRAId = user.reportingAuthorityId;
      const newRAId  = reportingAuthorityId ?? prevRAId;
      if (
        newRAId &&
        String(prevRAId || "") !== String(newRAId) &&
        ["EMPLOYEE", "RA"].includes(user.role)
      ) {
        try {
          const now = new Date();
          await EmployeeRAHistory.update(
            { effectiveTo: now },
            { where: { employeeId: user.id, effectiveTo: null } }
          );
          await EmployeeRAHistory.create({
            employeeId:    user.id,
            raId:          newRAId,
            effectiveFrom: now,
            effectiveTo:   null,
            assignedBy:    null,   // HRMS-driven change — no admin actor
          });
        } catch (histErr) {
          console.error("[HRMS SSO] Failed to track RA change in history:", histErr.message);
        }
      }

      user.reportingAuthorityId = reportingAuthorityId ?? user.reportingAuthorityId;
      user.isActive = isActive;

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
