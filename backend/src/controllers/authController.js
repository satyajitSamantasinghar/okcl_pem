const User = require("../models/User");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.register = async (req, res) => {
  try {
    const { employeeCode, name, email, password, role, department, reportingAuthorityId } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      employeeCode,
      name,
      email,
      passwordHash: hashedPassword,
      role,
      department,
      reportingAuthorityId
    });

    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

  const accessToken = jwt.sign(
  {
    userId: user._id,
    role: user.role
  },
  process.env.JWT_SECRET,
  { expiresIn: "1d" }
);

const refreshToken = jwt.sign(
  {
    userId: user._id
  },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: "7d" }
);

user.refreshToken = refreshToken;
await user.save();

res.json({
  accessToken,
  refreshToken,
  role: user.role,
  name: user.name
});

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.refreshAccessToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token required" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    const newAccessToken = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(403).json({ message: "Invalid refresh token" });
  }
};

exports.logout = async (req, res) => {
  try {
    const userId = req.user.userId;

    await User.findByIdAndUpdate(userId, {
      refreshToken: null
    });

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: "Logout failed" });
  }
};
