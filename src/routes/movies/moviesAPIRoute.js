import express from "express";
import {
	useMovieTmdbAPI,
	useMovieTmdbRefreshAPI,
} from "../../controllers/movies/tmdbAPI.js";
import { useTmdbMovieDiscoverAPI } from "../../controllers/movies/movieDiscoverAPI.js";
import {
	validateMovieDiscoverAPI,
	validateMovieMetaAPI,
	validateTmdbIdAPI,
} from "../../middleware/movies/validateMoviesAPI.js";

const moviesAPIRouter = express.Router();

moviesAPIRouter.get("/tmdb", validateMovieMetaAPI, useMovieTmdbAPI);
moviesAPIRouter.get("/tmdb-refresh", validateTmdbIdAPI, useMovieTmdbRefreshAPI);
moviesAPIRouter.get(
	"/tmdb-discover",
	validateMovieDiscoverAPI,
	useTmdbMovieDiscoverAPI,
);

export { moviesAPIRouter };
