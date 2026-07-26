import express from "express";
import { useIgdbForGameAPI } from "../../controllers/games/igdbForGameAPI.js";
import { useIgdbForDlcAPI } from "../../controllers/games/igdbForDlcAPI.js";
import { useIgdbByIdAPI } from "../../controllers/games/igdbByIdAPI.js";
import {
  validateGameAPI,
  validateIgdbId,
} from "../../middleware/games/validateGamesAPI.js";

const gamesAPIRouter = express.Router();

gamesAPIRouter.get("/igdb", validateGameAPI, useIgdbForGameAPI);
gamesAPIRouter.get("/igdb-dlc", validateIgdbId, useIgdbForDlcAPI);
gamesAPIRouter.get("/igdb-by-id", validateIgdbId, useIgdbByIdAPI);

export { gamesAPIRouter };
