const express = require("express");
const router  = express.Router();
const { verifyToken } = require("../middleware/authMiddleware");
const { Notification } = require("../models");   // ← Sequelize model from index.js
const { Op } = require("sequelize");

/* GET /notifications — recent notifications for current user */
router.get("/", verifyToken, async (req, res) => {
    try {
        // Mongoose: Notification.find({ userId }).sort({ createdAt: -1 }).limit(30)
        // Sequelize: findAll({ where, order, limit })
        const [notifications, unreadCount] = await Promise.all([
            Notification.findAll({
                where: { userId: req.user.userId },
                order: [["createdAt", "DESC"]],
                limit: 30,
            }),
            // Mongoose: countDocuments({ userId, read: false })
            // Sequelize: count({ where })
            Notification.count({
                where: { userId: req.user.userId, read: false },
            }),
        ]);

        res.json({ notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* PUT /notifications/read-all — mark all as read */
router.put("/read-all", verifyToken, async (req, res) => {
    try {
        // Mongoose: updateMany({ userId, read: false }, { read: true })
        // Sequelize: update(data, { where })
        await Notification.update(
            { read: true },
            { where: { userId: req.user.userId, read: false } }
        );
        res.json({ message: "All notifications marked as read" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* PUT /notifications/:id/read — mark single notification as read */
router.put("/:id/read", verifyToken, async (req, res) => {
    try {
        // Mongoose: findOneAndUpdate({ _id, userId }, { read: true })
        // Sequelize: findByPk then save (ensures ownership check)
        const notification = await Notification.findOne({
            where: { id: req.params.id, userId: req.user.userId },
        });

        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        notification.read = true;
        await notification.save();

        res.json({ message: "Notification marked as read" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
