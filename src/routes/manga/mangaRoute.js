import express from "express";
import {
	getRandomManga,
	getMangaList,
	getManga,
	patchManga,
	createManga,
	deleteManga,
} from "../../controllers/manga/mangaControllers.js";
import {
	validateMangaId,
	validateMangaData,
	validateMangaPatch,
	validateMangaCreate,
	validateMangaRefresh,
} from "../../middleware/manga/validateManga.js";

const mangaRouter = express.Router();

mangaRouter.get("/random", getRandomManga);
mangaRouter.get("/", getMangaList);
mangaRouter.get("/:id", validateMangaId, getManga);
mangaRouter.post("/", validateMangaCreate, validateMangaData, createManga);
mangaRouter.patch(
	"/:id",
	validateMangaId,
	validateMangaData,
	validateMangaPatch,
	patchManga,
);
mangaRouter.patch(
	"/:id/refresh",
	validateMangaId,
	validateMangaRefresh,
	patchManga,
);
mangaRouter.delete("/:id", validateMangaId, deleteManga);

export { mangaRouter };
