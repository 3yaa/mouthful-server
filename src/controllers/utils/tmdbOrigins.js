import { httpFetch } from "./httpFetch.js";

export const DRAMA = ["KR", "CN", "JP"];
// anime
const ANIMATION_GENRE = 16;
const ANIME_KEYWORD = 210024;

let restCountries = null;
function getRestCountries() {
	restCountries ??= httpFetch(
		`https://api.themoviedb.org/3/configuration/countries?api_key=${process.env.TMDB_API_KEY}`,
	)
		.then((r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json();
		})
		.then((list) =>
			list
				.map((c) => c.iso_3166_1)
				.filter((code) => !DRAMA.includes(code)),
		)
		.catch((e) => {
			restCountries = null;
			throw e;
		});
	return restCountries;
}

// country narrows drama to one of its own
export async function originParams(origin, country) {
	if (!origin) return "";
	if (origin === "drama")
		return (
			`&with_origin_country=${country ?? DRAMA.join("|")}` +
			`&without_genres=${ANIMATION_GENRE}&without_keywords=${ANIME_KEYWORD}`
		);
	return `&with_origin_country=${(await getRestCountries()).join("|")}`;
}
