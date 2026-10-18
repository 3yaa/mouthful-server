import { httpFetch } from "./httpFetch.js";

export const DRAMA = ["KR", "CN", "JP"];
// movies only -- bengali films come from both IN and BD
export const DESI = ["IN", "BD", "PK"];
// anime
const ANIMATION_GENRE = 16;
const ANIME_KEYWORD = 210024;
const JAPAN_LIVE = `&with_origin_country=JP&without_genres=${ANIMATION_GENRE}&without_keywords=${ANIME_KEYWORD}`;

let countries = null;
function allCountries() {
	countries ??= httpFetch(
		`https://api.themoviedb.org/3/configuration/countries?api_key=${process.env.TMDB_API_KEY}`,
	)
		.then((r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json();
		})
		.then((list) => list.map((c) => c.iso_3166_1))
		.catch((e) => {
			countries = null;
			throw e;
		});
	return countries;
}

export async function originsExcept(codes) {
	const rest = (await allCountries()).filter((code) => !codes.includes(code));
	return `&with_origin_country=${rest.join("|")}`;
}

// one TMDB query each -- drama reads two as one feed, country narrows it to one
export async function originFeeds(origin, country) {
	if (!origin) return [""];
	if (origin === "rest") return [await originsExcept(DRAMA)];
	if (country === "JP") return [JAPAN_LIVE];
	if (country) return [`&with_origin_country=${country}`];
	return ["&with_origin_country=KR|CN", JAPAN_LIVE];
}
