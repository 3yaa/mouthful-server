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

// a title search, or a pinned tmdb id when the caller already knows it
async function lookupShow({ title, year, forceAnime }, userId, pinnedId) {
	const { searchSaysAnime, ...detected } = await getTmdbId(
		title,
		year,
		userId,
		forceAnime,
		pinnedId,
	);
	// run anime chain concurrently
	const early = searchSaysAnime ? startAnimeChain(detected.tmdbId) : null;
	// only a live-action show carries seasons
	const enriched = await getTmdbShowEnrichment(
		detected.tmdbId,
		!searchSaysAnime,
	);
	if (runAnime(forceAnime, enriched.wantAnime)) {
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
	return {
		...detected,
		title: enriched.title ?? detected.title,
		...enriched.processedShow,
	};
}

export async function useShowAPI(req, res) {
	try {
		const pinnedId = req.query.tmdbId;
		const data = await lookupShow(req.query, req.user.id, pinnedId).catch(
			(error) => {
				// tmdb drops merged duplicates an old id list still points at -- the title finds it
				if (pinnedId && error.status === 404)
					return lookupShow(req.query, req.user.id);
				throw error;
			},
		);
		res.json({ success: true, data });
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
			runAnime(
				req.query.forceAnime,
				enriched.wantAnime || Boolean(storedAnime),
			)
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
