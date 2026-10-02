import {
	addSeasonRuntimes,
	getTmdbId,
	getTmdbShowEnrichment,
} from "./tmdbCalls/tmdbAPI.js";
import {
	cutIdsFromQuery,
	storedAnimeState,
} from "./anime/utils/utilFunctions.js";
import { runAnime } from "./anime/utils/isAnimeCheck.js";
import { applyChain, startAnimeChain } from "./anime/animeAPI.js";

const sendError = (res, error) => {
	console.error("Show fetch failed: ", error);
	const status = error.status ?? 500;
	res.status(status).json({
		success: false,
		...(error.title && { title: error.title }),
		...(error.tmdbId && { tmdbId: error.tmdbId }),
		message: status === 500 ? "Failed to fetch show" : error.message,
		error: error.error ?? error.message,
	});
};

export async function useShowAPI(req, res) {
	try {
		// uses to search
		const { searchSaysAnime, ...detected } = await getTmdbId(
			req.query.title,
			req.query.year,
			req.user.id,
			req.query.forceAnime,
			req.query.tmdbId,
		);
		// run anime chain concurrently
		const early = searchSaysAnime ? startAnimeChain(detected.tmdbId) : null;
		// only a live-action show carries seasons
		const enriched = await getTmdbShowEnrichment(
			detected.tmdbId,
			!searchSaysAnime,
		);
		if (runAnime(req.query.forceAnime, enriched.wantAnime)) {
			applyChain(
				enriched.processedShow,
				await (early ?? startAnimeChain(detected.tmdbId)),
			);
		}
		await addSeasonRuntimes(
			enriched.processedShow,
			detected.tmdbId,
			enriched.runtimes,
		);
		res.json({
			success: true,
			data: {
				...detected,
				title: enriched.title ?? detected.title,
				...enriched.processedShow,
			},
		});
	} catch (error) {
		sendError(res, error);
	}
}

export async function useShowRefreshAPI(req, res) {
	try {
		const tmdbId = Number(req.query.tmdbId);
		const storedAnime = await storedAnimeState(req.user.id, tmdbId);
		const requestedCuts = cutIdsFromQuery(req.query.cuts);
		const preferredCuts = requestedCuts.length
			? requestedCuts
			: (storedAnime?.cuts ?? []);
		const refresh = req.query.refresh === "1";
		//
		const chain = () => startAnimeChain(tmdbId, preferredCuts, refresh);
		const early = runAnime(req.query.forceAnime, Boolean(storedAnime))
			? chain()
			: null;
		const enriched = await getTmdbShowEnrichment(tmdbId, !early);
		if (
			runAnime(req.query.forceAnime, enriched.wantAnime || Boolean(storedAnime))
		) {
			applyChain(enriched.processedShow, await (early ?? chain()));
		}
		await addSeasonRuntimes(
			enriched.processedShow,
			tmdbId,
			enriched.runtimes,
		);
		//
		res.json({
			success: true,
			data: { title: null, tmdbId, ...enriched.processedShow },
		});
	} catch (error) {
		sendError(res, error);
	}
}
