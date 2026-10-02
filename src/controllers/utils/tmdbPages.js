import { httpFetch } from "./httpFetch.js";

const TMDB_PAGE = 20;
const TMDB_MAX_PAGES = 500;

export async function tmdbPageSlice(baseUrl, page, perPage) {
	const start = (Math.max(page, 1) - 1) * perPage;
	const first = Math.floor(start / TMDB_PAGE) + 1;
	const last = Math.min(
		Math.floor((start + perPage - 1) / TMDB_PAGE) + 1,
		TMDB_MAX_PAGES,
	);
	const pages = await Promise.all(
		Array.from({ length: Math.max(last - first + 1, 0) }, async (_, i) => {
			const r = await httpFetch(`${baseUrl}&page=${first + i}`);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json();
		}),
	);
	const results = pages.flatMap((p) => p.results ?? []);
	const offset = start - (first - 1) * TMDB_PAGE;
	const total = Math.min(
		pages[0]?.total_results ?? 0,
		TMDB_MAX_PAGES * TMDB_PAGE,
	);
	return {
		results: results.slice(offset, offset + perPage),
		totalPages: Math.max(1, Math.ceil(total / perPage)),
	};
}
