const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    type: {
        type: String,
        enum: [
            "MONTHLY_PLAN_REJECTED",
            "YEARLY_PLAN_REJECTED",
            "YEARLY_PLAN_APPROVED",
            "MONTHLY_EVALUATED",
            "QUARTERLY_EVALUATED",
            "YEARLY_REPORT_EVALUATED",
            "GENERAL"
        ],
        required: true
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
