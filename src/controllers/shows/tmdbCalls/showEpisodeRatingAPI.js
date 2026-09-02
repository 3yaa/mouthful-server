import { getShowEpisodes } from "../../imdbRating/imdbEpRatingCache.js";
import { getImdbRatings } from "../../imdbRating/imdbRatingCache.js";
import { getFribbMap } from "../anime/externalCalls/fribbMap.js";
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

async function filmRatings(ids) {
	if (!ids.length) return {};
	const fribb = await getFribbMap();
	const imdbOf = new Map();
	for (const id of ids) {
		const imdbId = fribb.byAnilist.get(id)?.imdbId;
		if (imdbId) imdbOf.set(id, imdbId);
	}
	if (!imdbOf.size) return {};
	const ratings = await getImdbRatings([...new Set(imdbOf.values())]);
	const out = {};
	for (const [id, imdbId] of imdbOf) {
		const rating = ratings[imdbId]?.rating;
		if (rating != null) out[id] = rating;
	}
	return out;
}

export async function useOmdbEpisodeRatings(req, res) {
	try {
		const { imdbId, tmdbId, showId, films } = req.query;
		// the anilist ids of the films on the chain, when the caller has any
		const filmIds = String(films ?? "")
			.split(",")
			.map((id) => Number(id))
			.filter((id) => Number.isSafeInteger(id) && id > 0);

		const resolvedImdbId = await resolveImdbId(
			imdbId,
			tmdbId,
			showId,
			req.user.id,
		);

		const [episodes, ratings, filmScores] = await Promise.all([
			getShowEpisodes(resolvedImdbId),
			getImdbRatings([resolvedImdbId]),
			filmRatings(filmIds),
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
			// keyed by anilist id -- the chain has no other name for a film
			films: filmScores,
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
