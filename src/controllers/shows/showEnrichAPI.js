import dotenv from "dotenv";
import { useTmdbEnrichAPI } from "./tmdbEnrichAPI.js";
import { buildAnimeChain } from "../anilist/animeChain.js";
dotenv.config();

export async function useShowEnrichAPI(req, res) {
	try {
		const tmdbId = req.query.tmdbId;
		// "1"/"0" anime toggle
		const forceAnime = req.query.forceAnime;
		// anilist ids cuts (film/season)
		const preferredCuts = String(req.query.cuts ?? "")
			.split(",")
			.map((id) => parseInt(id, 10))
			.filter(Number.isInteger);

		let result;
		try {
			result = await useTmdbEnrichAPI(tmdbId);
		} catch (e) {
			return res.status(e.status ?? 500).json({
				success: false,
				message: `TMDB Enrich API error: ${e.message}`,
				error: "TMDB Enrich API failure",
			});
		}
		if (!result) {
			return res.status(404).json({
				success: false,
				message: "Show not found in TMDB Enrich",
				error: "No show results",
			});
		}
		//
		const {
			title,
			originalTitle,
			processedShow,
			wantAnime: tmdbSaysAnime,
		} = result;

		// run anilist
		const wantsAnime =
			forceAnime === "1" || (forceAnime !== "0" && tmdbSaysAnime);
		if (wantsAnime) {
			try {
				const chain = await buildAnimeChain({
					nativeTitle: originalTitle,
					title,
					year: processedShow.released_date,
					preferredCuts,
					// bypass anilist cache
					forceRefresh: req.query.refresh === "1",
				});
				// no episodic slot -> use tmdb season list
				if (chain?.slots?.length) {
					const { slots, studio, ...meta } = chain;
					processedShow.isAnime = true;
					processedShow.seasons = slots;
					Object.assign(processedShow, meta);
					// anime uses studio names
					if (studio) processedShow.creator = studio;
					// anilist's cover joins the rest of the posters
					const cover = slots[0]?.posterUrl;
					if (cover && !processedShow.posters.includes(cover)) {
						processedShow.posters = [
							...processedShow.posters,
							cover,
						];
					}
				}
			} catch (e) {
				// anilist failiure is non-blocking
				console.error("AniList chain failed: ", e.message);
			}
		}
		//
		res.status(200).json({
			success: true,
			data: processedShow,
		});
	} catch (error) {
		console.error("Show enrich fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch show",
			error: error.message,
		});
	}
}
