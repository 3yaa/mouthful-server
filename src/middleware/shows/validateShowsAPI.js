import { DRAMA } from "../../controllers/utils/tmdbOrigins.js";

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
	const { year, month, page, origin, country, months } = req.query;

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
	if (
		country !== undefined &&
		(origin !== "drama" || !DRAMA.includes(country))
	) {
		return res.status(400).json({
			success: false,
			message: `country is drama only, one of ${DRAMA.join(", ")}`,
		});
	}
	// a season at most -- the upcoming pages group months
	if (months !== undefined && !/^[1-3]$/.test(months)) {
		return res.status(400).json({
			success: false,
			message: "months must be 1, 2 or 3",
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

const isDigits = (value) => /^\d+$/.test(value ?? "");

// anime node by anilist id, any other show by tmdb id + season
export const validateShowTrailerAPI = (req, res, next) => {
	const { anilistId, tmdbId, season } = req.query;

	if (!isDigits(anilistId) && !isDigits(tmdbId)) {
		return res.status(400).json({
			success: false,
			message: "anilistId or tmdbId required",
		});
	}
	if (season !== undefined && !isDigits(season)) {
		return res.status(400).json({
			success: false,
			message: "season must be a number",
		});
	}
	req.validated = {
		...(req.validated ?? {}),
		anilistId: isDigits(anilistId) ? Number(anilistId) : null,
		tmdbId: isDigits(tmdbId) ? tmdbId : null,
		season: isDigits(season) ? Number(season) : null,
	};
	next();
};
