import { httpFetch } from "./httpFetch.js";

const DRAMA = ["KR", "CN"];

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

export async function countryParam(origin) {
	if (!origin) return "";
	const codes = origin === "drama" ? DRAMA : await getRestCountries();
	return `&with_origin_country=${codes.join("|")}`;
}
