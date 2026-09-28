import express from "express";
import {
	getSteamLink,
	linkSteam,
	unlinkSteam,
} from "../controllers/steam/steamLinkController.js";
import { validateSteamLink } from "../middleware/steam/validateSteam.js";

const steamRouter = express.Router();

steamRouter.get("/", getSteamLink);
steamRouter.put("/", validateSteamLink, linkSteam);
steamRouter.delete("/", unlinkSteam);

export { steamRouter };
