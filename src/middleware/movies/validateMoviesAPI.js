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

export const validateAnimeFilmAPI = (req, res, next) => {
	const { imdbId, title } = req.query;
	if (!imdbId && !title) {
		return res.status(400).json({
			success: false,
			message: "imdbId or title is required",
		});
	}
	if (imdbId !== undefined && !/^tt\d{5,12}$/.test(String(imdbId))) {
		return res.status(400).json({
			success: false,
			message: "imdbId must look like tt1234567",
		});
	}
	next();
};
