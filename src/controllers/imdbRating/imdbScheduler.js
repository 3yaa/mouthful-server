import { refreshRatings } from "./imdbRatingCache.js";
import { refreshEpisodes } from "./imdbEpRatingCache.js";

function msUntilMidnight() {
	const next = new Date();
	next.setHours(24, 0, 0, 0);
	return next - Date.now();
}

export function scheduleNext() {
	setTimeout(async () => {
		try {
			await Promise.all([refreshRatings(), refreshEpisodes()]);
			console.log("IMDB cache refreshed -- midnight");
		} catch (e) {
			console.error("IMDB midnight refresh failed: ", e.message);
		}
		scheduleNext();
	}, msUntilMidnight()).unref();
}
