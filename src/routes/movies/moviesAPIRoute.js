import express from "express";
import {
	useMovieTmdbAPI,
	useMovieTmdbRefreshAPI,
} from "../../controllers/movies/tmdbAPI.js";
import {
	validateMovieMetaAPI,
	validateTmdbIdAPI,
} from "../../middleware/movies/validateMoviesAPI.js";

const moviesAPIRouter = express.Router();

moviesAPIRouter.get("/tmdb", validateMovieMetaAPI, useMovieTmdbAPI);
moviesAPIRouter.get("/tmdb-refresh", validateTmdbIdAPI, useMovieTmdbRefreshAPI);

export { moviesAPIRouter };
