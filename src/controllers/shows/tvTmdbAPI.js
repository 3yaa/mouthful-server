import dotenv from "dotenv";
import { getLogoUrls } from "../utils/tmdbLogo.js";
import { getBackdropUrls, getPosterUrls } from "../utils/tmdbArtwork.js";
import { isAnime, buildAnimeChain } from "../anilist/animeChain.js";

dotenv.config();

export async function useTmdbTvAPI(req, res) {
	try {
		const tmdbId = req.query.tmdbId;
		// "1"/"0" from the add-modal toggle -- overrides detection either way
		const forceAnime = req.query.forceAnime;
		const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=external_ids,images,keywords&include_image_language=en,null`;
		// make call
		const response = await fetch(url);
		if (!response.ok) {
			return res.status(response.status).json({
				success: false,
				message: `TMDB-TV API error: ${response.statusText}`,
				error: `TMDB-TV API failure`,
			});
		}
		// check if valid
		const show = (await response.json()) || {};
		if (Object.keys(show).length === 0) {
			return res.status(404).json({
				success: false,
				message: "Show not found in TMDB-TV",
				error: "No show results",
			});
		}
		// ranked -- logo_urls
		const logos = getLogoUrls(show.images);
		// ranked -- poster/backdrop
		const posters = getPosterUrls(show.images, show.poster_path, "w500");
		const backdrops = getBackdropUrls(show.images, show.backdrop_path);
		// data clean up
		const processedShow = {
			seasons: show.seasons
				.filter((season) => season.season_number > 0)
				.map((season) => ({
					season_number: season.season_number,
					episode_count: season.episode_count,
					// poster_url: season.poster_path
					//   ? `https://image.tmdb.org/t/p/w500${season.poster_path}`
					//   : null,
				})),
			// created_by: show.created_by.map((created_by) => ({
			//   name: created_by.name,
			// })),
			studio: show.production_companies[0].name,
			imdbId: show.external_ids?.imdb_id ?? null,
			poster_url: posters[0] ?? null,
			backdrop_url: backdrops[0] ?? null,
			posters,
			backdrops,
			logo_url: logos[0] ?? null,
			logos,
		};

		// anilist runs after tmdb, never alongside it
		const wantsAnime =
			forceAnime === "1" || (forceAnime !== "0" && isAnime(show));
		if (wantsAnime) {
			try {
				const chain = await buildAnimeChain({
					nativeTitle: show.original_name,
					fallbackTitle: show.name,
					year:
						parseInt(show.first_air_date?.slice(0, 4)) || undefined,
					tmdbSeasons: processedShow.seasons,
				});
				if (chain) {
					processedShow.isAnime = true;
					processedShow.source = "anilist";
					Object.assign(processedShow, chain);
				}
			} catch (e) {
				// enrichment only -- a bad anilist call must not sink the tmdb result
				console.error("AniList chain failed: ", e.message);
			}
		}
		//
		res.status(200).json({
			success: true,
			data: processedShow,
		});
	} catch (error) {
		console.error("TMDB-TV fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch show from TMDB-TV",
			error: error.message,
		});
	}
}
