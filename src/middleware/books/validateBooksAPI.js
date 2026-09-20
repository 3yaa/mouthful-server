const MAX_TITLE_LENGTH = 200;

export function validateBooksAPI(req, res, next) {
	const raw = req.query.title;

	if (typeof raw !== "string") {
		return res.status(400).json({
			success: false,
			message: "Missing required query parameter: title",
		});
	}

	// collapse whitespace; Typesense treats runs of spaces as separate tokens
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

	// single character searches return thousands of irrelevant fuzzy matches
	if (title.length < 2) {
		return res.status(400).json({
			success: false,
			message: "Query parameter 'title' must be at least 2 characters",
		});
	}

	req.validated = { ...(req.validated ?? {}), title };
	next();
}
