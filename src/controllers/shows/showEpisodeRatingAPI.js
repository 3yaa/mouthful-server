import { fetchOmdbEpisodeIds } from "./omdbEpisodeIdAPI.js";
import { getImdbRatings } from "../imdbRatingsAPI.js";

export async function useOmdbEpisodeRatings(req, res) {
	try {
		const { imdbId, totalSeason } = req.query;

		const { episodes, failures } = await fetchOmdbEpisodeIds(
			imdbId,
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
