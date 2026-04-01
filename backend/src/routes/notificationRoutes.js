const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/authMiddleware");
const Notification = require("../models/Notification");

/* GET /notifications — recent notifications for current user */
router.get("/", verifyToken, async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user.userId })
            .sort({ createdAt: -1 })
            .limit(30);
        const unreadCount = await Notification.countDocuments({ userId: req.user.userId, read: false });
        res.json({ notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* PUT /notifications/read-all — mark all as read */
router.put("/read-all", verifyToken, async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.user.userId, read: false }, { read: true });
        res.json({ message: "All notifications marked as read" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* PUT /notifications/:id/read — mark single as read */
router.put("/:id/read", verifyToken, async (req, res) => {
    try {
        await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            { read: true }
        );
        res.json({ message: "Notification marked as read" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
