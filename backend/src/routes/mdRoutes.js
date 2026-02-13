const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const mdController = require("../controllers/mdController");

router.post(
  "/final-approval",
  verifyToken,
  authorizeRoles("MD"),
  mdController.finalApproval
); 

module.exports = router;
