import { getShowEpisodes } from "../imdbRating/imdbEpRatingCache.js";
import { getImdbRatings } from "../imdbRating/imdbRatingCache.js";
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
		await pool.query("UPDATE shows SET imdb_id=$1 WHERE id=$2", [fetched, showId]);
	}

	return fetched;
}

export async function useOmdbEpisodeRatings(req, res) {
	try {
		const { imdbId, tmdbId, showId } = req.query;

		const resolvedImdbId = await resolveImdbId(imdbId, tmdbId, showId);

		const [episodes, ratings] = await Promise.all([
			getShowEpisodes(resolvedImdbId),
			getImdbRatings([resolvedImdbId]),
		]);

		if (episodes.length === 0) {
			return res.status(404).json({
				success: false,
				message: "No episodes found for this show in IMDB dataset",
			});
		}

		const episodeTconsts = episodes.map((ep) => ep.tconst);
		const episodeRatings = await getImdbRatings(episodeTconsts);

		const data = episodes.map((ep) => ({
			season: ep.season,
			episode: ep.episode,
			score: episodeRatings[ep.tconst]?.rating ?? null,
		}));

		const seriesEntry = ratings[resolvedImdbId];

		res.status(200).json({
			success: true,
			series: {
				rating: seriesEntry?.rating ?? null,
				votes: seriesEntry?.votes ?? null,
			},
			data,
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
