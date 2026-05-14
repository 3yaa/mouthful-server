import express from "express";
import { useTmdbSearchAPI } from "../../controllers/shows/searchTmdbAPI.js";
import { useTmdbTvAPI } from "../../controllers/shows/tvTmdbAPI.js";
import {
  validateShowsAPI,
  validateShowsDiscoverAPI,
  validateTMDBIdAPI,
} from "../../middleware/shows/validateShowsAPI.js";
import { useTmdbTvDiscoverAPI } from "../../controllers/shows/showDiscoverAPI.js";

const showsAPIRouter = express.Router();

showsAPIRouter.get("/tmdb", validateShowsAPI, useTmdbSearchAPI);
showsAPIRouter.get("/tmdb-tv", validateTMDBIdAPI, useTmdbTvAPI);
showsAPIRouter.get(
  "/tmdb-tv-discover",
  validateShowsDiscoverAPI,
  useTmdbTvDiscoverAPI,
);

export { showsAPIRouter };
