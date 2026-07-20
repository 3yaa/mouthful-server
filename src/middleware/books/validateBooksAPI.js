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

// export const validateBooksAPI = (req, res, next) => {
//   const { query, limit } = req.query;

//   if (!query) {
//     return res.status(400).json({
//       success: false,
//       message: "title parameter is required",
//     });
//   }

//   if (!limit) {
//     return res.status(400).json({
//       success: false,
//       message: "limit parameter is required",
//     });
//   }

//   const limitNum = parseInt(limit);
//   if (isNaN(limitNum) || limitNum <= 0) {
//     return res.status(400).json({
//       success: false,
//       message: "limit must be a positive integer",
//     });
//   }

//   if (limitNum > 20) {
//     return res.status(400).json({
//       success: false,
//       message: "limit cannot exceed 20",
//     });
//   }

//   req.query.query = query.trim();
//   req.query.limit = parseInt(limit);

//   next();
// };

// export const validateSeriesAPI = (req, res, next) => {
//   const openLibraryID = req.query.openLibraryID;

//   if (!openLibraryID) {
//     return res.status(400).json({
//       success: false,
//       message: "open library id required",
//     });
//   }

//   next();
// };
