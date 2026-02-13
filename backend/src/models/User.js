const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  employeeCode: {
    type: String,
    required: true,
    unique: true
  },

  name: {
    type: String,
    required: true
  },

  email: {
    type: String,
    required: true,
    unique: true
  },

  passwordHash: {
    type: String,
    required: true
  },

  role: {
    type: String,
    enum: ["EMPLOYEE", "RA", "HRD", "MD"],
    required: true
  },

  department: String,

  reportingAuthorityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  refreshToken: {
  type: String
},


  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
