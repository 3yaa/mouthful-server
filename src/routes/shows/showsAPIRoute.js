import express from "express";
import { useTmdbSearchAPI } from "../../controllers/shows/searchTmdbAPI.js";
import { useTmdbTvAPI } from "../../controllers/shows/tvTmdbAPI.js";
import {
	validateShowRatingAPI,
	validateShowsAPI,
	validateShowsDiscoverAPI,
	validateTMDBIdAPI,
} from "../../middleware/shows/validateShowsAPI.js";
import { useTmdbTvDiscoverAPI } from "../../controllers/shows/showDiscoverAPI.js";
import { useOmdbEpisodeRatings } from "../../controllers/shows/showEpisodeRatingAPI.js";

const showsAPIRouter = express.Router();

showsAPIRouter.get("/tmdb", validateShowsAPI, useTmdbSearchAPI);
showsAPIRouter.get("/tmdb-tv", validateTMDBIdAPI, useTmdbTvAPI);
showsAPIRouter.get(
	"/tmdb-tv-discover",
	validateShowsDiscoverAPI,
	useTmdbTvDiscoverAPI,
);
showsAPIRouter.get("/episodes-score", validateShowRatingAPI, useOmdbEpisodeRatings);

export { showsAPIRouter };
