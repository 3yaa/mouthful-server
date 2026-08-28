import express from "express";
import { useIgdbForGameAPI } from "../../controllers/games/igdbForGameAPI.js";
import { useIgdbForDlcAPI } from "../../controllers/games/igdbForDlcAPI.js";
import { useIgdbRefreshAPI } from "../../controllers/games/igdbRefreshAPI.js";
import { useSteamGridLogosAPI } from "../../controllers/games/steamGridLogoAPI.js";
import {
	validateGameAPI,
	validateIgdbId,
	validateTitleOnly,
} from "../../middleware/games/validateGamesAPI.js";

const gamesAPIRouter = express.Router();

gamesAPIRouter.get("/igdb", validateGameAPI, useIgdbForGameAPI);
gamesAPIRouter.get("/igdb-dlc", validateIgdbId, useIgdbForDlcAPI);
gamesAPIRouter.get("/igdb-refresh", validateIgdbId, useIgdbRefreshAPI);
gamesAPIRouter.get("/sgdb-logos", validateTitleOnly, useSteamGridLogosAPI);

export { gamesAPIRouter };
