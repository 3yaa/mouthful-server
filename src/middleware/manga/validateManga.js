const MAX_NOTE_LENGTH = 1000;
const MAX_CHAPTER = 100000;
const VALID_STATUSES = ["Reading", "Want to Read", "Completed", "Dropped"];

const badChapter = (value) =>
	!Number.isInteger(value) || value < 0 || value > MAX_CHAPTER;

export const validateMangaId = (req, res, next) => {
	const mangaId = req.params.id;

	if (!mangaId || isNaN(mangaId) || parseInt(mangaId) <= 0) {
		return res.status(400).json({
			success: false,
			message: "Invalid Manga ID format",
		});
	}

	req.params.id = parseInt(mangaId);
	next();
};

export const validateMangaData = (req, res, next) => {
	const { score, note, dateCompleted, curChapter } = req.body;
	// for score
	if (score !== undefined) {
		if (score !== null) {
			if (
				typeof score !== "object" ||
				typeof score.mu !== "number" ||
				typeof score.phi !== "number" ||
				!isFinite(score.mu) ||
				!isFinite(score.phi) ||
				score.mu < -5000 ||
				score.mu > 5000 ||
				score.phi < -5000 ||
				score.phi > 5000
			) {
				return res.status(400).json({
					success: false,
					message:
						"Invalid score field provided (must be { mu, phi } or null)",
				});
			}
		}
	}
	// for notes -- null/empty clears
	if (note !== undefined) {
		if (note !== null && typeof note !== "string") {
			return res.status(400).json({
				success: false,
				message: "Invalid note field provided (must be string or null)",
			});
		}
		if (note && note.length > MAX_NOTE_LENGTH) {
			return res.status(400).json({
				success: false,
				message: "Invalid note field provided (>1000 characters)",
			});
		}
	}
	// for dateCompleted
	if (dateCompleted !== undefined) {
		// allow null to clear the date
		if (dateCompleted !== null) {
			const date = new Date(dateCompleted);
			if (isNaN(date.getTime())) {
				return res.status(400).json({
					success: false,
					message:
						"Invalid dateCompleted field provided (must be valid date or null)",
				});
			}
			// ensure it's not a future date
			if (date > new Date()) {
				return res.status(400).json({
					success: false,
					message:
						"Invalid dateCompleted field provided (cannot be in the future)",
				});
			}
		}
	}
	// for curChapter
	if (curChapter !== undefined && badChapter(curChapter)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid curChapter field provided (must be a non-negative integer)",
		});
	}

	next();
};

//
export const validateMangaPatch = (req, res, next) => {
	const updates = req.body;
	const allowedFields = [
		"indirectUpdate",
		"score",
		"status",
		"note",
		"dateCompleted",
		"series",
		"curChapter",
	];
	// for status
	if (updates.status && !VALID_STATUSES.includes(updates.status)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid status field provided ('Reading' | 'Want to Read' | 'Completed' | 'Dropped')",
		});
	}
	// check if exists
	if (!updates || Object.keys(updates).length === 0) {
		return res.status(400).json({
			success: false,
			message: "No update field provided",
		});
	}
	// check if allowed
	const invalidFields = Object.keys(updates).filter(
		(field) => !allowedFields.includes(field),
	);
	if (invalidFields.length > 0) {
		return res.status(400).json({
			success: false,
			message: "Invalid update field provided",
		});
	}

	next();
};

// metadata-only allowlist for the "reload from source" flow
export const validateMangaRefresh = (req, res, next) => {
	const updates = req.body;
	const allowedFields = [
		"indirectUpdate",
		"cover",
		"chapters",
		"rating",
		"series",
		"title",
		"author",
		"datePublished",
		"anilistId",
	];
	// check if exists
	if (!updates || Object.keys(updates).length === 0) {
		return res.status(400).json({
			success: false,
			message: "No update field provided",
		});
	}
	// check if allowed
	const invalidFields = Object.keys(updates).filter(
		(field) => !allowedFields.includes(field),
	);
	if (invalidFields.length > 0) {
		return res.status(400).json({
			success: false,
			message: "Invalid refresh field provided",
		});
	}
	// null is how a serial that started running again reads
	if (
		updates.chapters !== undefined &&
		updates.chapters !== null &&
		badChapter(updates.chapters)
	) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid chapters field provided (must be a non-negative integer or null)",
		});
	}

	next();
};

export const validateMangaCreate = (req, res, next) => {
	const {
		title,
		datePublished,
		status,
		anilistId,
		cover,
		chapters,
		curChapter,
		rating,
	} = req.body;
	// REQUIRED FIELDS
	// title
	if (!title || title.trim() === "") {
		return res.status(400).json({
			success: false,
			message: "No title to create manga",
		});
	}
	// anilist id
	if (!Number.isSafeInteger(anilistId) || anilistId <= 0) {
		return res.status(400).json({
			success: false,
			message: "No anilistId to create manga",
		});
	}
	// status
	if (!status) {
		req.body.status = "Want to Read";
	} else {
		if (!VALID_STATUSES.includes(status)) {
			return res.status(400).json({
				success: false,
				message:
					"Invalid status provided ('Reading' | 'Want to Read' | 'Completed' | 'Dropped')",
			});
		}
	}
	// NON REQUIRED
	// date published
	if (datePublished !== undefined && datePublished !== null) {
		const parsedYear = parseInt(datePublished);
		if (
			isNaN(parsedYear) ||
			!Number.isInteger(parsedYear) ||
			parsedYear < 1000 ||
			parsedYear > 9999
		) {
			return res.status(400).json({
				success: false,
				message: "Date published must be a 4-digit year (e.g., 2001)",
			});
		}
		req.body.datePublished = parsedYear;
	}
	// cover
	if (cover !== undefined && cover !== null) {
		if (
			typeof cover !== "object" ||
			Array.isArray(cover) ||
			typeof cover.url !== "string" ||
			!cover.url ||
			(cover.color !== undefined &&
				cover.color !== null &&
				typeof cover.color !== "string")
		) {
			return res.status(400).json({
				success: false,
				message:
					"Invalid cover field provided (must be { url, color } or null)",
			});
		}
	}
	// chapters -- null while it is still running
	if (chapters !== undefined && chapters !== null && badChapter(chapters)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid chapters field provided (must be a non-negative integer or null)",
		});
	}
	// curChapter
	if (
		curChapter !== undefined &&
		curChapter !== null &&
		badChapter(curChapter)
	) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid curChapter field provided (must be a non-negative integer)",
		});
	}
	// rating
	if (rating !== undefined && rating !== null) {
		if (
			typeof rating !== "number" ||
			!isFinite(rating) ||
			rating < 0 ||
			rating > 10
		) {
			return res.status(400).json({
				success: false,
				message:
					"Invalid rating field provided (must be a number between 0 and 10)",
			});
		}
	}

	next();
};
