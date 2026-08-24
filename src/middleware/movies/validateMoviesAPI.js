export const validateMovieMetaAPI = (req, res, next) => {
  const { title, year } = req.query;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      message: "title parameter is required",
    });
  }
  req.query.title = title.trim();

  const parsedYear = parseInt(year);
  if (isNaN(parsedYear) || parsedYear < 1000 || parsedYear > 9999) {
    delete req.query.year;
  } else {
    req.query.year = String(parsedYear);
  }

  next();
};

export const validateTmdbIdAPI = (req, res, next) => {
  const tmdbId = req.query.tmdbId;

  if (!tmdbId || !/^\d+$/.test(tmdbId)) {
    return res.status(400).json({
      success: false,
      message: "valid tmdb id required",
    });
  }

  next();
};