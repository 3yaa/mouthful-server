import express from "express";
import {
  getRandomGames,
  getGames,
  getGame,
  patchGame,
  createGame,
  deleteGame,
} from "../../controllers/games/gameControllers.js";
import {
  validateGameId,
  validateGameData,
  validateGamePatch,
  validateGameCreate,
  validateGameRefresh,
} from "../../middleware/games/validateGames.js";

const gamesRouter = express.Router();

gamesRouter.get("/random", getRandomGames);
gamesRouter.get("/", getGames);
gamesRouter.get("/:id", validateGameId, getGame);
gamesRouter.post("/", validateGameCreate, validateGameData, createGame);
gamesRouter.patch(
  "/:id",
  validateGameId,
  validateGameData,
  validateGamePatch,
  patchGame
);
gamesRouter.patch(
  "/:id/refresh",
  validateGameId,
  validateGameRefresh,
  patchGame
);
gamesRouter.delete("/:id", validateGameId, deleteGame);

export { gamesRouter };
