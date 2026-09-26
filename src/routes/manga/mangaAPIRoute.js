import express from "express";
import {
	validateMangaAPI,
	validateAnilistId,
} from "../../middleware/manga/validateMangaAPI.js";
import {
	useAnilistMangaAPI,
	useAnilistMangaMultiAPI,
	useAnilistMangaRefreshAPI,
} from "../../controllers/manga/anilistMangaAPI.js";

const mangaAPIRouter = express.Router();

mangaAPIRouter.get("/anilist", validateMangaAPI, useAnilistMangaAPI);
mangaAPIRouter.get("/anilist-multi", validateMangaAPI, useAnilistMangaMultiAPI);
mangaAPIRouter.get(
	"/anilist-refresh",
	validateAnilistId,
	useAnilistMangaRefreshAPI,
);

export { mangaAPIRouter };
