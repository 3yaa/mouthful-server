export const validateShowsAPI = (req, res, next) => {
	const { title, year, tmdbId } = req.query;
	// missing title
	if (!title) {
		return res.status(400).json({
			success: false,
			message: "title parameter is required",
		});
	}
	if (tmdbId !== undefined && !/^\d+$/.test(tmdbId)) {
		return res.status(400).json({
			success: false,
			message: "tmdbId must be a number",
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
	const { year, month, page, origin } = req.query;

	if (!year || !month || !page) {
		return res.status(400).json({
			success: false,
			message: "year, month, and page are required",
		});
	}
	if (origin && origin !== "drama" && origin !== "rest") {
		return res.status(400).json({
			success: false,
			message: "origin must be drama or rest",
		});
	}
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

	next();
};

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
const ANIME_TABS = ["new", "continuing", "movies"];

export const validateAnimeDiscoverAPI = (req, res, next) => {
	const season = String(req.query.season ?? "").toUpperCase();
	const year = parseInt(req.query.year, 10);
	const page = parseInt(req.query.page, 10);
	const tab = req.query.tab ?? "new";
	if (!SEASONS.includes(season)) {
		return res.status(400).json({
			success: false,
			message: "season must be winter, spring, summer or fall",
		});
	}
	if (!Number.isInteger(year) || year < 1940 || year > 2100) {
		return res.status(400).json({
			success: false,
			message: "year must be a 4-digit year",
		});
	}
	if (!ANIME_TABS.includes(tab)) {
		return res.status(400).json({
			success: false,
			message: "tab must be new, continuing or movies",
		});
	}
	req.validated = {
		...(req.validated ?? {}),
		season,
		year,
		tab,
		page: Number.isInteger(page) && page > 0 ? page : 1,
	};
	next();
};
