export const validateMovieMetaAPI = (req, res, next) => {
	const { title, year, tmdbId } = req.query;

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

	if (tmdbId && /^\d+$/.test(tmdbId)) req.query.tmdbId = tmdbId;
	else delete req.query.tmdbId;

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

const ORIGINS = ["drama", "rest"];

export const validateMovieDiscoverAPI = (req, res, next) => {
	const year = parseInt(req.query.year, 10);
	const month = parseInt(req.query.month, 10);
	const page = parseInt(req.query.page, 10);
	const origin = req.query.origin ?? "rest";

	if (!Number.isInteger(year) || year < 1900 || year > 2100) {
		return res.status(400).json({
			success: false,
			message: "year must be a 4-digit year",
		});
	}
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		return res.status(400).json({
			success: false,
			message: "month must be 1-12",
		});
	}
	if (!ORIGINS.includes(origin)) {
		return res.status(400).json({
			success: false,
			message: "origin must be drama or rest",
		});
	}
	req.validated = {
		...(req.validated ?? {}),
		year,
		month,
		origin,
		page: Number.isInteger(page) && page > 0 ? page : 1,
	};
	next();
};
