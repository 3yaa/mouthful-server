import express from "express";
import {
	useMovieTmdbAPI,
	useMovieTmdbRefreshAPI,
} from "../../controllers/movies/tmdbAPI.js";
import {
	validateAnimeFilmAPI,
	validateMovieMetaAPI,
	validateTmdbIdAPI,
} from "../../middleware/movies/validateMoviesAPI.js";
import { useAnimeFilmResolveAPI } from "../../controllers/shows/anime/filmResolve.js";

const moviesAPIRouter = express.Router();

moviesAPIRouter.get("/tmdb", validateMovieMetaAPI, useMovieTmdbAPI);
moviesAPIRouter.get("/tmdb-refresh", validateTmdbIdAPI, useMovieTmdbRefreshAPI);
moviesAPIRouter.get(
	"/anime-film",
	validateAnimeFilmAPI,
	useAnimeFilmResolveAPI,
);

export { moviesAPIRouter };
