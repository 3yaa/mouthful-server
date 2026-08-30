import express from "express";
import {
	useShowAPI,
	useShowRefreshAPI,
} from "../../controllers/shows/showAPI.js";
import {
	validateAnimeStudioAPI,
	validateShowRatingAPI,
	validateShowsAPI,
	validateShowsDiscoverAPI,
	validateTMDBIdAPI,
} from "../../middleware/shows/validateShowsAPI.js";
import { useTmdbTvDiscoverAPI } from "../../controllers/shows/tmdbCalls/showDiscoverAPI.js";
import { useOmdbEpisodeRatings } from "../../controllers/shows/tmdbCalls/showEpisodeRatingAPI.js";
import { useAnimeStudioAPI } from "../../controllers/shows/anime/animeStudioAPI.js";

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
showsAPIRouter.get("/anime-studio", validateAnimeStudioAPI, useAnimeStudioAPI);

export { showsAPIRouter };
