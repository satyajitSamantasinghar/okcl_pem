exports.allowMonthlyPlanSubmission = (req, res, next) => {
  const today = new Date();
  const day = today.getDate();

  // if (day < 1 || day > 7) {
  //   return res.status(403).json({
  //     message: "Monthly plan submission allowed only from 1st to 7th"
  //   });
  // }

  next();
};

exports.allowMonthlyAchievementSubmission = (req, res, next) => {
  const today = new Date();
  const day = today.getDate();

  // if (day < 25) {
  //   return res.status(403).json({
  //     message: "Monthly achievement submission allowed from 25th onwards"
  //   });
  // }

  next();
};
