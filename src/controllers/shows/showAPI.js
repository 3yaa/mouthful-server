import { getTmdbId, getTmdbShowEnrichment } from "./tmdbCalls/tmdbAPI.js";
import {
	applyAnime,
	cutIdsFromQuery,
	storedAnimeState,
} from "./anime/utils/utilFunctions.js";

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
		const detected = await getTmdbId(
			req.query.title,
			req.query.year,
			req.user.id,
			req.query.forceAnime,
		);
		const enriched = await getTmdbShowEnrichment(detected.tmdbId);
		await applyAnime(
			enriched.processedShow,
			detected.tmdbId,
			req.query.forceAnime,
			enriched.wantAnime,
			[],
			false,
		);
		res.json({
			success: true,
			data: { ...detected, ...enriched.processedShow },
		});
	} catch (error) {
		sendError(res, error);
	}
}

export async function useShowRefreshAPI(req, res) {
	try {
		const tmdbId = Number(req.query.tmdbId);
		const storedAnime = await storedAnimeState(req.user.id, tmdbId);
		const enriched = await getTmdbShowEnrichment(tmdbId);
		const requestedCuts = cutIdsFromQuery(req.query.cuts);
		const preferredCuts = storedAnime?.cuts.length
			? storedAnime.cuts
			: requestedCuts;

		await applyAnime(
			enriched.processedShow,
			tmdbId,
			req.query.forceAnime,
			enriched.wantAnime || Boolean(storedAnime),
			preferredCuts,
			req.query.refresh === "1",
		);
		res.json({
			success: true,
			data: { title: null, tmdbId, ...enriched.processedShow },
		});
	} catch (error) {
		sendError(res, error);
	}
}
