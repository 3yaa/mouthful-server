import express from "express";
import {
  getRandomShows,
  getShows,
  getShow,
  patchShow,
  createShow,
  deleteShow,
} from "../../controllers/shows/showControllers.js";
import {
  validateShowId,
  validateShowData,
  validateShowPatch,
  validateShowCreate,
  validateShowRefresh,
  validateAnimeCut,
} from "../../middleware/shows/validateShows.js";
import { selectAnimeCut } from "../../controllers/shows/anime/pickCutController.js";

const showsRouter = express.Router();

showsRouter.get("/random", getRandomShows);
showsRouter.get("/", getShows);
showsRouter.get("/:id", validateShowId, getShow);
showsRouter.post("/", validateShowCreate, validateShowData, createShow);
showsRouter.patch(
  "/:id",
  validateShowId,
  validateShowData,
  validateShowPatch,
  patchShow
);
showsRouter.patch(
  "/:id/refresh",
  validateShowId,
  validateShowRefresh,
  patchShow
);
showsRouter.patch(
  "/:id/anime/cut",
  validateShowId,
  validateAnimeCut,
  selectAnimeCut
);
showsRouter.delete("/:id", validateShowId, deleteShow);

export { showsRouter };
