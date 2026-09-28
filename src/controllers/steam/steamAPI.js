import dotenv from "dotenv";
import { pool } from "../../config/db.js";
import { httpFetch } from "../utils/httpFetch.js";
import { makeIgdbRequestWithRety } from "../games/igdbInternal/igdbAPI.js";

dotenv.config();

const STEAM_BASE = "https://api.steampowered.com";
// steam only counts playtime every few minutes anyway
const PLAYTIME_TTL = 10 * 60 * 1000;
// igdb's external_game_source for steam
const STEAM_SOURCE = 1;
// a list load waits on these, so a slow steam gives up early and the estimate stands
const STEAM_TIMEOUT = 5_000;

export const steamEnabled = () => !!process.env.STEAM_API_KEY;

async function steamFetch(path, params) {
	const query = new URLSearchParams({
		key: process.env.STEAM_API_KEY,
		format: "json",
		...params,
	});
	const response = await httpFetch(
		`${STEAM_BASE}${path}?${query}`,
		{},
		STEAM_TIMEOUT,
	);
	if (!response.ok) {
		throw Object.assign(new Error(`Steam API error: ${response.status}`), {
			status: response.status,
		});
	}
	return response.json();
}

// a 17 digit id
export async function resolveSteamId(input) {
	const text = String(input ?? "").trim();
	const byId =
		text.match(/^(7656119\d{10})$/) ??
		text.match(/steamcommunity\.com\/profiles\/(7656119\d{10})/);
	if (byId) return byId[1];
	const vanity =
		text.match(/steamcommunity\.com\/id\/([^/?#\s]+)/)?.[1] ??
		(/^[\w-]{2,32}$/.test(text) ? text : null);
	if (!vanity) return null;
	const data = await steamFetch("/ISteamUser/ResolveVanityURL/v1/", {
		vanityurl: vanity,
	});
	return data?.response?.success === 1 ? data.response.steamid : null;
}

export async function getSteamProfile(steamId) {
	const data = await steamFetch("/ISteamUser/GetPlayerSummaries/v2/", {
		steamids: steamId,
	});
	const player = data?.response?.players?.[0];
	return player
		? {
				steamId,
				name: player.personaname ?? null,
				avatarUrl: player.avatarmedium ?? null,
			}
		: null;
}

const playtimeCache = new Map();

// steam app id -> minutes played; null when the account's game details are private
export async function getPlaytimes(steamId, { fresh = false } = {}) {
	const cached = playtimeCache.get(steamId);
	if (!fresh && cached && Date.now() - cached.at < PLAYTIME_TTL)
		return cached.minutes;
	const data = await steamFetch("/IPlayerService/GetOwnedGames/v1/", {
		steamid: steamId,
		include_played_free_games: 1,
	});
	// a private profile answers with an empty response
	const games = data?.response?.games;
	const minutes = Array.isArray(games)
		? new Map(games.map((game) => [game.appid, game.playtime_forever ?? 0]))
		: null;
	playtimeCache.set(steamId, { at: Date.now(), minutes });
	return minutes;
}

export const forgetPlaytimes = (steamId) => playtimeCache.delete(steamId);

// igdb id -> steam app ids
const appIdCache = new Map();

async function steamAppIdsFor(igdbIds) {
	const unknown = [...new Set(igdbIds.filter(Boolean))].filter(
		(id) => !appIdCache.has(id),
	);
	for (let i = 0; i < unknown.length; i += 500) {
		const batch = unknown.slice(i, i + 500);
		const response = await makeIgdbRequestWithRety(
			`fields game, uid; where game = (${batch.join(",")}) & external_game_source = ${STEAM_SOURCE}; limit 500;`,
			"external_games",
		);
		if (!response.ok) throw new Error(`IGDB API error: ${response.status}`);
		const rows = await response.json();
		for (const id of batch) appIdCache.set(id, []);
		for (const row of rows ?? []) {
			const appId = Number(row.uid);
			if (Number.isInteger(appId)) appIdCache.get(row.game)?.push(appId);
		}
	}
	return appIdCache;
}

export async function withPlaytime(userId, games) {
	const rows = Array.isArray(games) ? games : [games];
	if (!steamEnabled() || !rows.length) return games;
	try {
		const result = await pool.query(
			"SELECT steam_id FROM users WHERE id=$1",
			[userId],
		);
		const steamId = result.rows[0]?.steam_id;
		if (!steamId) return games;
		const [played, appIds] = await Promise.all([
			getPlaytimes(steamId),
			steamAppIdsFor(rows.map((game) => game.igdbId)),
		]);
		if (!played) return games;
		for (const game of rows) {
			// steam logs a dlc's time on its base game, so a dlc row never matches
			const minutes = Math.max(
				0,
				...(appIds.get(game.igdbId) ?? []).map(
					(id) => played.get(id) ?? 0,
				),
			);
			game.playtime = minutes || null;
		}
	} catch (error) {
		console.error("Steam playtime lookup failed: ", error.message);
	}
	return games;
}
