import { getShowEpisodes } from "../../imdbRating/imdbEpRatingCache.js";
import { getImdbRatings } from "../../imdbRating/imdbRatingCache.js";
import { pool } from "../../../config/db.js";
import dotenv from "dotenv";
import { tmdbFetch } from "./tmdbAPI.js";

dotenv.config();

async function resolveImdbId(imdbId, tmdbId, showId, userId) {
	if (imdbId) return imdbId;

	const data = await tmdbFetch(`/tv/${tmdbId}`, {
		append_to_response: "external_ids",
	});
	const fetched = data.external_ids?.imdb_id;
	if (!fetched) throw new Error("No IMDB ID found for this show");
	//
	if (showId) {
		await pool.query(
			"UPDATE shows SET imdb_id=$1 WHERE id=$2 AND user_id=$3",
			[fetched, showId, userId],
		);
	}

	return fetched;
}

export async function useOmdbEpisodeRatings(req, res) {
	try {
		const { imdbId, tmdbId, showId } = req.query;

		const resolvedImdbId = await resolveImdbId(
			imdbId,
			tmdbId,
			showId,
			req.user.id,
		);

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
