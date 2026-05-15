export const validateTmdbCastAPI = (req, res, next) => {
  const tmdbId = parseInt(req.query.tmdbId);
  if (!tmdbId) {
    return res
      .status(400)
      .json({ success: false, message: "tmdbId is required" });
  }
  req.query.tmdbId = tmdbId;
  next();
};

export const validateTmdbActorWorksAPI = (req, res, next) => {
  const actorId = parseInt(req.query.actorId);
  if (!actorId) {
    return res
      .status(400)
      .json({ success: false, message: "actorId is required" });
  }
  req.query.actorId = actorId;
  next();
};
