import express from "express";
import { useTmdbIdAPI } from "../../controllers/shows/tmdbIdAPI.js";
import { useShowEnrichAPI } from "../../controllers/shows/showEnrichAPI.js";
import {
	validateShowRatingAPI,
	validateShowsAPI,
	validateShowsDiscoverAPI,
	validateTMDBIdAPI,
} from "../../middleware/shows/validateShowsAPI.js";
import { useTmdbTvDiscoverAPI } from "../../controllers/shows/showDiscoverAPI.js";
import { useOmdbEpisodeRatings } from "../../controllers/shows/showEpisodeRatingAPI.js";

const showsAPIRouter = express.Router();

showsAPIRouter.get("/tmdb", validateShowsAPI, useTmdbIdAPI);
showsAPIRouter.get("/tmdb-tv", validateTMDBIdAPI, useShowEnrichAPI);
showsAPIRouter.get(
	"/tmdb-tv-discover",
	validateShowsDiscoverAPI,
	useTmdbTvDiscoverAPI,
);
showsAPIRouter.get(
	"/episodes-score",
	validateShowRatingAPI,
	useOmdbEpisodeRatings,
);

export { showsAPIRouter };
