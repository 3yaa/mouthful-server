import { pool } from "../../config/db.js";
import {
	forgetPlaytimes,
	getPlaytimes,
	getSteamProfile,
	resolveSteamId,
	steamEnabled,
} from "./steamAPI.js";

const disabled = (res) =>
	res.status(503).json({
		success: false,
		message: "Steam is not set up on this server",
		error: "Missing STEAM_API_KEY",
	});

const storedSteamId = async (userId) =>
	(await pool.query("SELECT steam_id FROM users WHERE id=$1", [userId]))
		.rows[0]?.steam_id ?? null;

// the linked account, with whether its game details can be read
export const getSteamLink = async (req, res) => {
	try {
		if (!steamEnabled()) return disabled(res);
		const steamId = await storedSteamId(req.user.id);
		if (!steamId) return res.json({ success: true, data: null });
		const [profile, played] = await Promise.all([
			getSteamProfile(steamId),
			getPlaytimes(steamId),
		]);
		res.json({
			success: true,
			data: { ...profile, steamId, isPublic: played !== null },
		});
	} catch (error) {
		console.error("Steam link read failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to read Steam link",
			error: error.message,
		});
	}
};

export const linkSteam = async (req, res) => {
	try {
		if (!steamEnabled()) return disabled(res);
		const steamId = await resolveSteamId(req.body.profile);
		if (!steamId) {
			return res.status(404).json({
				success: false,
				message: "No Steam profile found for that link",
				error: "Unknown profile",
			});
		}
		const played = await getPlaytimes(steamId, { fresh: true });
		// saved either way -- flipping game details to public later needs no relink
		await pool.query("UPDATE users SET steam_id=$1 WHERE id=$2", [
			steamId,
			req.user.id,
		]);
		const profile = await getSteamProfile(steamId);
		res.json({
			success: true,
			data: { ...profile, steamId, isPublic: played !== null },
		});
	} catch (error) {
		console.error("Steam link failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to link Steam",
			error: error.message,
		});
	}
};

export const unlinkSteam = async (req, res) => {
	try {
		const steamId = await storedSteamId(req.user.id);
		await pool.query("UPDATE users SET steam_id=NULL WHERE id=$1", [
			req.user.id,
		]);
		if (steamId) forgetPlaytimes(steamId);
		res.json({ success: true, data: null });
	} catch (error) {
		console.error("Steam unlink failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to unlink Steam",
			error: error.message,
		});
	}
};
