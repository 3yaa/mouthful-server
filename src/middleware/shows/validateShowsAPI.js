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
	const { year, month, countryOrigin, page } = req.query;

	if (!year || !month || !page) {
		return res.status(400).json({
			success: false,
			message: "year, month, and page are required",
		});
	}

	const y = parseInt(year);
	const m = parseInt(month);
	const now = new Date();
	const isFuture =
		y > now.getFullYear() ||
		(y === now.getFullYear() && m > now.getMonth() + 1);

	req.query.year = y;
	req.query.month = m;
	req.query.page = parseInt(page);
	req.query.isFuture = isFuture;

	next();
};

export const validateShowRatingAPI = (req, res, next) => {
	const { imdbId, totalSeason } = req.query;

	if (!imdbId) {
		return res.status(400).json({
			success: false,
			message: "imdb id required",
		});
	}

	const season = Number(totalSeason);
	if (!Number.isInteger(season) || season < 1) {
		return res.status(400).json({
			success: false,
			message: "total season needs to be an integer > 0",
		});
	}

	req.query.totalSeason = season;

	next();
};
