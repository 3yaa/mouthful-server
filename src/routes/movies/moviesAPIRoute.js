import express from "express";
import { useOmdbAPI } from "../../controllers/movies/omdbAPI.js";
import { useTmdbAPI } from "../../controllers/movies/tmdbAPI-old.js";
import { useWikidataAPI } from "../../controllers/movies/wikidataAPI.js";
import {
  useMovieTmdbAPI,
  useMovieTmdbByIdAPI,
} from "../../controllers/movies/tmdbAPI.js";
import {
  validateMoviesAPI,
  validateImdbIdAPI,
  validateMovieMetaAPI,
  validateTmdbIdAPI,
} from "../../middleware/movies/validateMoviesAPI.js";

const moviesAPIRouter = express.Router();

moviesAPIRouter.get("/tmdb", validateMovieMetaAPI, useMovieTmdbAPI);
moviesAPIRouter.get("/tmdb-by-id", validateTmdbIdAPI, useMovieTmdbByIdAPI);

moviesAPIRouter.get("/omdb", validateMoviesAPI, useOmdbAPI);
moviesAPIRouter.get("/tmdb-old", validateImdbIdAPI, useTmdbAPI);
moviesAPIRouter.get("/wikidata", validateImdbIdAPI, useWikidataAPI);

export { moviesAPIRouter };
