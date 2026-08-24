import express from "express";
import {
	useMovieTmdbAPI,
	useMovieTmdbByIdAPI,
} from "../../controllers/movies/tmdbAPI.js";
import {
	validateMovieMetaAPI,
	validateTmdbIdAPI,
} from "../../middleware/movies/validateMoviesAPI.js";

const moviesAPIRouter = express.Router();

moviesAPIRouter.get("/tmdb", validateMovieMetaAPI, useMovieTmdbAPI);
moviesAPIRouter.get("/tmdb-by-id", validateTmdbIdAPI, useMovieTmdbByIdAPI);

export { moviesAPIRouter };
