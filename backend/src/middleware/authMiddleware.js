const jwt = require("jsonwebtoken");

/**
 * verifyToken — JWT authentication middleware (PERN stack)
 *
 * Reads the Bearer token from the Authorization header, verifies it,
 * and attaches the decoded payload to req.user.
 *
 * req.user shape: { userId, role, iat, exp }
 *
 * No Mongoose/Sequelize calls needed — JWT is stateless.
 * Token is signed in authController at login time.
 */
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Must have "Bearer <token>"
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, role, iat, exp }
    next();
  } catch (error) {
    // Distinguish expired tokens from invalid ones for better UX
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired. Please log in again." });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
};
