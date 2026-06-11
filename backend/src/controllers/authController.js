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
const bcrypt    = require("bcrypt");
const jwt       = require("jsonwebtoken");

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
