import express from "express";
import {
	useShowAPI,
	useShowRefreshAPI,
} from "../../controllers/shows/showAPI.js";
import {
	validateShowRatingAPI,
	validateShowsAPI,
	validateShowsDiscoverAPI,
	validateTMDBIdAPI,
} from "../../middleware/shows/validateShowsAPI.js";
import { useTmdbTvDiscoverAPI } from "../../controllers/shows/tmdbCalls/showDiscoverAPI.js";
import { useOmdbEpisodeRatings } from "../../controllers/shows/tmdbCalls/showEpisodeRatingAPI.js";

const showsAPIRouter = express.Router();

showsAPIRouter.get("/external", validateShowsAPI, useShowAPI);
showsAPIRouter.get("/external-reload", validateTMDBIdAPI, useShowRefreshAPI);
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
