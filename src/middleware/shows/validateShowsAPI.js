export const validateShowsAPI = (req, res, next) => {
  const { title, year } = req.query;

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "title parameter is required",
    });
  }

  req.query.title = title.trim();
  req.query.limit = parseInt(year);

  next();
};

export const validateTMDBIdAPI = (req, res, next) => {
  const tmdbId = req.query.tmdbId;

  if (!tmdbId) {
    return res.status(400).json({
      success: false,
      message: "tmdb id required",
    });
  }

  next();
};

export const validateShowsDiscoverAPI = (req, res, next) => {
  const { year, month, countryOrigin, page, isFuture } = req.query;

  if (!year || !month || !page) {
    return res.status(400).json({
      success: false,
      message: "year, month, and page are required",
    });
  }

  req.query.year = parseInt(year);
  req.query.month = parseInt(month);
  req.query.page = parseInt(page);
  req.query.isFuture = isFuture === "true";

  next();
};
