export const validateShowsAPI = (req, res, next) => {
	const { title, year } = req.query;
	// missing title
	if (!title) {
		return res.status(400).json({
			success: false,
			message: "title parameter is required",
		});
	}
	req.query.title = title.trim();
	// drop anything that is not a 4-digit year
	const parsedYear = parseInt(year, 10);
	req.query.year =
		Number.isInteger(parsedYear) && parsedYear >= 1000 && parsedYear <= 9999
			? parsedYear
			: "";
	//
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
	const { imdbId, tmdbId } = req.query;

	if (!imdbId && !tmdbId) {
		return res.status(400).json({
			success: false,
			message: "imdbId or tmdbId required",
		});
	}

	next();
};

export const validateAnimeStudioAPI = (req, res, next) => {
	const studio = String(req.query.studio ?? "").trim();

	if (!studio) {
		return res.status(400).json({
			success: false,
			message: "studio parameter is required",
		});
	}

	req.query.studio = studio;
	next();
};
