import { fetchOmdbEpisodeIds } from "./omdbEpisodeIdAPI.js";
import { getImdbRatings } from "../imdbRatingsAPI.js";
import { pool } from "../../config/db.js";
import dotenv from "dotenv";

dotenv.config();

async function resolveImdbId(imdbId, tmdbId, showId) {
	if (imdbId) return imdbId;

	const res = await fetch(
		`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=external_ids`,
	);
	if (!res.ok) throw new Error(`TMDB external_ids HTTP ${res.status}`);
	const data = await res.json();
	const fetched = data.external_ids?.imdb_id;
	if (!fetched) throw new Error("No IMDB ID found for this show");

	if (showId) {
		await pool.query("UPDATE shows SET imdb_id=$1 WHERE id=$2", [
			fetched,
			showId,
		]);
	}

	return fetched;
}

export async function useOmdbEpisodeRatings(req, res) {
	try {
		const { imdbId, tmdbId, showId, totalSeason } = req.query;

		const resolvedImdbId = await resolveImdbId(imdbId, tmdbId, showId);

		const { episodes, failures } = await fetchOmdbEpisodeIds(
			resolvedImdbId,
			totalSeason,
		);

		const imdbIds = episodes.map((ep) => ep.imdbId);
		const ratings = await getImdbRatings(imdbIds);

		const data = episodes.map((ep) => ({
			season: ep.season,
			episode: ep.episodeNum,
			score: ratings[ep.imdbId]?.rating ?? null,
		}));

		res.status(failures.length === 0 ? 200 : 207).json({
			success: failures.length === 0,
			data,
			failures: failures.map((f) => ({
				season: f.season,
				status: f.status,
				message: f.message,
			})),
		});
	} catch (error) {
		console.error("Episode ratings fetch failed:", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch episode ratings",
			error: error.message,
		});
	}
}
