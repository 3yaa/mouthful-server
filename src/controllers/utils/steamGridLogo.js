import dotenv from "dotenv";
import { httpFetch } from "./httpFetch.js";

dotenv.config();

const SGDB_BASE = "https://www.steamgriddb.com/api/v2";

// how many to hand the picker
const MAX_LOGOS = 12;

// Every call here is best-effort.
async function sgdbFetch(path) {
	const key = process.env.STEAMGRIDDB_API_KEY;
	if (!key) return null;
	const response = await httpFetch(`${SGDB_BASE}${path}`, {
		headers: { Authorization: `Bearer ${key}` },
	});
	if (!response.ok) return null;
	const body = await response.json();
	return body?.success ? (body.data ?? null) : null;
}

// punctuation and spacing differ constantly between igdb and steamgriddb"
const normalize = (name) =>
	(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// --- 1st call -- title | steamgriddb game id
async function findGameId(title) {
	const results = await sgdbFetch(
		`/search/autocomplete/${encodeURIComponent(title)}`,
	);
	if (!results?.length) return null;
	// autocomplete is already relevance-ordere
	const wanted = normalize(title);
	const exact = results.find((game) => normalize(game.name) === wanted);
	return (exact ?? results[0])?.id ?? null;
}

// english first, then png
const rank = (logo) =>
	(logo.language === "en" ? 4 : 0) + (logo.mime === "image/png" ? 2 : 0);

const votes = (logo) => (logo.upvotes ?? 0) - (logo.downvotes ?? 0);

// --- 2nd call -- game id | every official static wordmark on file
async function getLogosForId(id) {
	const logos = await sgdbFetch(
		`/logos/game/${id}?styles=official&types=static`,
	);
	if (!logos?.length) return [];
	return logos
		.filter(
			(logo) => logo.url && !logo.nsfw && !logo.humor && !logo.epilepsy,
		)
		.sort(
			(a, b) =>
				rank(b) - rank(a) ||
				(b.score ?? 0) - (a.score ?? 0) ||
				votes(b) - votes(a),
		)
		.slice(0, MAX_LOGOS)
		.map((logo) => logo.url);
}

export async function getSteamGridLogos(title) {
	try {
		const wanted = title?.trim();
		if (!wanted) return [];
		const id = await findGameId(wanted);
		if (!id) return [];
		return await getLogosForId(id);
	} catch (error) {
		console.error("SteamGridDB logo fetch failed: ", error.message);
		return [];
	}
}
