// import dotenv from "dotenv";

// dotenv.config();

// export async function fetchOmdbEpisodeIds(imdbID, totalSeasons) {
// 	const seasonNumbers = Array.from({ length: Number(totalSeasons) }, (_, i) => i + 1);

// 	const results = await Promise.all(
// 		seasonNumbers.map(async (curSeason) => {
// 			try {
// 				const url = `http://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&i=${imdbID}&Season=${curSeason}`;
// 				const response = await fetch(url);

// 				if (!response.ok) {
// 					return { ok: false, season: curSeason, status: response.status, message: `OMDb API error: ${response.statusText}` };
// 				}

// 				const season = await response.json();
// 				if (season.Response === "False") {
// 					return { ok: false, season: curSeason, status: 404, message: season.Error || "season not found" };
// 				}

// 				const episodes = (season.Episodes ?? []).map((ep) => ({
// 					season: curSeason,
// 					episodeNum: ep.Episode,
// 					imdbId: ep.imdbID,
// 				}));
// 				return { ok: true, episodes };
// 			} catch (err) {
// 				return { ok: false, season: curSeason, status: 502, message: err.message };
// 			}
// 		}),
// 	);

// 	const succeeded = results.filter((r) => r.ok);
// 	const failed = results.filter((r) => !r.ok);
// 	return { episodes: succeeded.flatMap((r) => r.episodes), failures: failed };
// }

// export async function useOmdbEpisodeIdAPI(req, res) {
// 	try {
// 		const { imdbID, totalSeasons } = req.query;
// 		const { episodes, failures } = await fetchOmdbEpisodeIds(imdbID, totalSeasons);

// 		res.status(failures.length === 0 ? 200 : 207).json({
// 			success: failures.length === 0,
// 			data: episodes,
// 			failures: failures.map((f) => ({ season: f.season, status: f.status, message: f.message })),
// 		});
// 	} catch (error) {
// 		console.error("OMDb fetch failed: ", error);
// 		res.status(500).json({ success: false, message: "Failed to fetch episodes from OMDb", error: error.message });
// 	}
// }
