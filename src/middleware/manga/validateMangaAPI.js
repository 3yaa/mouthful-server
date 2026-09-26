const MAX_TITLE_LENGTH = 200;

const parseAnilistId = (raw) => {
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export function validateMangaAPI(req, res, next) {
	const raw = req.query.title;

	if (typeof raw !== "string") {
		return res.status(400).json({
			success: false,
			message: "Missing required query parameter: title",
		});
	}

	const title = raw.trim().replace(/\s+/g, " ");

	if (!title) {
		return res.status(400).json({
			success: false,
			message: "Query parameter 'title' cannot be empty",
		});
	}

	if (title.length > MAX_TITLE_LENGTH) {
		return res.status(400).json({
			success: false,
			message: `Query parameter 'title' must be ${MAX_TITLE_LENGTH} characters or fewer`,
		});
	}

	// a series jump already knows which entry it wants
	let anilistId = null;
	if (req.query.anilistId !== undefined) {
		anilistId = parseAnilistId(req.query.anilistId);
		if (!anilistId) {
			return res.status(400).json({
				success: false,
				message: "anilistId must be a positive integer",
			});
		}
	}

	req.validated = { ...(req.validated ?? {}), title, anilistId };
	next();
}

export function validateAnilistId(req, res, next) {
	const anilistId = parseAnilistId(req.query.anilistId);

	if (!anilistId) {
		return res.status(400).json({
			success: false,
			message: "anilistId parameter is required (positive integer)",
		});
	}

	req.validated = { ...(req.validated ?? {}), anilistId };
	next();
}
