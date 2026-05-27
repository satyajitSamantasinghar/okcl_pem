const mongoose = require('mongoose');
const MonthlyPlan = require('./src/models/MonthlyPlan');
require('dotenv').config();

async function test() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/PES');
    console.log("Connected to MongoDB");

    const plans = await MonthlyPlan.aggregate([
      { $match: { month: "2026-05" } },
      { $sort: { month: -1, submittedAt: -1 } },
      { $limit: 100 },

      // Join employee info
      {
        $lookup: {
          from: "users",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
          pipeline: [{ $project: { name: 1, employeeCode: 1, department: 1 } }]
        }
      },
      { $unwind: { path: "$employee", preserveNullAndEmptyArrays: false } },

      // Join monthly evaluation (left join — plan may have no evaluation yet)
      {
        $lookup: {
          from: "monthlyevaluations",
          let: { empId: "$employeeId", m: "$month" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employeeId", "$$empId"] },
                    { $eq: ["$month", "$$m"] }
                  ]
                }
              }
            },
            { $project: { status: 1, score: 1 } }
          ],
          as: "evaluation"
        }
      },
      { $unwind: { path: "$evaluation", preserveNullAndEmptyArrays: true } },

      // Join monthly achievement
      {
        $lookup: {
          from: "monthlyachievements",
          let: { planId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$monthlyPlanId", "$$planId"] } } },
            { $project: { status: 1 } }
          ],
          as: "achievement"
        }
      },
      { $unwind: { path: "$achievement", preserveNullAndEmptyArrays: true } },

      // Project final shape — mirrors the original per-plan structure
      {
        $project: {
          _id: 1,
          month: 1,
          status: 1,
          submittedAt: 1,
          employeeId: {
            _id: "$employee._id",
            name: "$employee.name",
            employeeCode: "$employee.employeeCode",
            department: "$employee.department"
          },
          evaluationStatus: { $ifNull: ["$evaluation.status", null] },
          evaluationScore: { $ifNull: ["$evaluation.score", null] },
          hasAchievement: {
            $and: [
              { $ne: [{ $type: "$achievement" }, "missing"] },
              { $ne: ["$achievement.status", "DRAFT"] }
            ]
          }
        }
      }
    ]);

    console.log("Success:", plans.length);
  } catch (err) {
    console.error("Aggregation Error:", err.message);
  } finally {
    mongoose.disconnect();
  }
}

test();
