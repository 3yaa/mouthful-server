const MAX_NOTE_LENGTH = 1000;
const VALID_STATUSES = ["Watching", "Want to Watch", "Completed", "Dropped"];

// shared so a row score and a part score can never drift apart
const badScore = (score) =>
	typeof score !== "object" ||
	typeof score.mu !== "number" ||
	typeof score.phi !== "number" ||
	!isFinite(score.mu) ||
	!isFinite(score.phi) ||
	score.mu < -5000 ||
	score.mu > 5000 ||
	score.phi < -5000 ||
	score.phi > 5000;

const badNote = (note) =>
	(note !== null && typeof note !== "string") ||
	(note && note.length > MAX_NOTE_LENGTH);

export const validateShowId = (req, res, next) => {
	const showId = req.params.id;

	if (!showId || isNaN(showId) || parseInt(showId) <= 0) {
		return res.status(400).json({
			success: false,
			message: "Invalid Show ID format",
		});
	}

	req.params.id = parseInt(showId);
	next();
};

export const validateShowData = (req, res, next) => {
	const { score, note, dateCompleted } = req.body;
	// for score
	if (score !== undefined && score !== null && badScore(score)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid score field provided (must be { mu, phi } or null)",
		});
	}
	// for notes -- null/empty clears
	if (note !== undefined && badNote(note)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid note field provided (string up to 1000 chars, or null)",
		});
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

	next();
};

//
export const validateShowPatch = (req, res, next) => {
	const updates = req.body;
	const allowedFields = [
		"indirectUpdate",
		"score",
		"status",
		"note",
		"dateCompleted",
		"curSeasonIndex",
		"curEpisode",
		"franchisePoster",
	];
	// for status
	if (updates.status && !VALID_STATUSES.includes(updates.status)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid status field provided ('Watching' | 'Want to Watch' | 'Completed' | 'Dropped')",
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

export const validatePartId = (req, res, next) => {
	const anilistId = Number(req.params.anilistId);
	if (!Number.isSafeInteger(anilistId) || anilistId <= 0) {
		return res.status(400).json({
			success: false,
			message: "Invalid AniList id format",
		});
	}
	req.params.anilistId = anilistId;
	next();
};

export const validateShowPart = (req, res, next) => {
	const { score, note, hidden } = req.body;
	const allowedFields = ["indirectUpdate", "score", "note", "hidden"];
	const invalidFields = Object.keys(req.body ?? {}).filter(
		(field) => !allowedFields.includes(field),
	);
	if (invalidFields.length > 0) {
		return res.status(400).json({
			success: false,
			message: "Invalid part field provided (score | note | hidden)",
		});
	}
	// an empty body would write nothing and still bump last_updated
	if (score === undefined && note === undefined && hidden === undefined) {
		return res.status(400).json({
			success: false,
			message: "No part field provided",
		});
	}
	if (score !== undefined && score !== null && badScore(score)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid score field provided (must be { mu, phi } or null)",
		});
	}
	if (note !== undefined && badNote(note)) {
		return res.status(400).json({
			success: false,
			message:
				"Invalid note field provided (string up to 1000 chars, or null)",
		});
	}
	if (hidden !== undefined && typeof hidden !== "boolean") {
		return res.status(400).json({
			success: false,
			message: "Invalid hidden field provided (must be boolean)",
		});
	}
	next();
};

export const validateAnimeCut = (req, res, next) => {
	const chosenId = Number(req.body?.chosenAnilistId);
	if (!Number.isSafeInteger(chosenId) || chosenId <= 0) {
		return res.status(400).json({
			success: false,
			message: "chosenAnilistId must be a positive integer",
		});
	}
	req.body.chosenAnilistId = chosenId;
	next();
};

// metadata-only allowlist for the "reload from source" flow.
export const validateShowRefresh = (req, res, next) => {
	const updates = req.body;
	const allowedFields = [
		"indirectUpdate",
		"posterUrl",
		"backdropUrl",
		"logoUrl",
		"creator",
		"seasons",
		"curSeasonIndex",
		"curEpisode",
		"anilistId",
		"dateReleased",
		"franchisePoster",
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

	// lets patchShow tell a reload apart from an ordinary edit
	req.isRefresh = true;
	next();
};

export const validateShowCreate = (req, res, next) => {
	const { title, dateReleased, status, tmdbId } = req.body;
	// REQUIRED FIELDS
	// title
	if (!title || title.trim() === "") {
		return res.status(400).json({
			success: false,
			message: "No title to create show",
		});
	}
	// tmdbId
	if (!tmdbId) {
		return res.status(400).json({
			success: false,
			message: "No tmdbId to create show",
		});
	}
	// status
	if (!status) {
		req.body.status = "Want to Watch";
	} else {
		if (!VALID_STATUSES.includes(status)) {
			return res.status(400).json({
				success: false,
				message:
					"Invalid status provided ('Watching' | 'Want to Watch' | 'Completed' | 'Dropped')",
			});
		}
	}
	// NON REQUIRED
	// date published
	if (dateReleased !== undefined) {
		const parsedYear = parseInt(dateReleased);
		if (
			isNaN(parsedYear) ||
			!Number.isInteger(parsedYear) ||
			parsedYear < 1000 ||
			parsedYear > 9999
		) {
			return res.status(400).json({
				success: false,
				message: "Date released must be a 4-digit year (e.g., 2001)",
			});
		}
		req.body.dateReleased = parsedYear;
	}

	next();
};
