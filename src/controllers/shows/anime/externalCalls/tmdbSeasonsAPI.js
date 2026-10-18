import { httpFetch } from "../../../utils/httpFetch.js";

// when each season of a tmdb show first aired -- empty when tmdb has nothing
export async function tmdbSeasonAirDates(tmdbId) {
	try {
		const res = await httpFetch(
			`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}`,
		);
		if (!res.ok) return [];
		const show = await res.json();
		return (show.seasons ?? [])
			.filter((season) => season.season_number > 0 && season.air_date)
			.map((season) => Date.parse(season.air_date));
	} catch {
		return [];
	}
}
