/**
 * authorizeRoles — Role-based access control middleware (PERN stack)
 *
 * Usage: router.get("/route", verifyToken, authorizeRoles("HRD", "MD"), handler)
 *
 * Relies on req.user.role being set by verifyToken before this runs.
 * No Mongoose/Sequelize calls needed — role is embedded in the JWT payload.
 */
exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
    // Guard: verifyToken must run first
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${roles.join(", ")}. Your role: ${req.user.role}.`,
      });
    }

    next();
  };
};
