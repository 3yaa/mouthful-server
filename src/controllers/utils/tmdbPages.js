import { httpFetch } from "./httpFetch.js";

const TMDB_PAGE = 20;
const TMDB_MAX_PAGES = 500;

export async function tmdbPageSlice(baseUrl, page, perPage) {
	const lastOurs = Math.ceil((TMDB_MAX_PAGES * TMDB_PAGE) / perPage);
	const start = (Math.min(Math.max(page, 1), lastOurs) - 1) * perPage;
	const first = Math.floor(start / TMDB_PAGE) + 1;
	const last = Math.min(
		Math.floor((start + perPage - 1) / TMDB_PAGE) + 1,
		TMDB_MAX_PAGES,
	);
	const fetchPage = async (n) => {
		const r = await httpFetch(`${baseUrl}&page=${n}`);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return r.json();
	};
	const pages = await Promise.all(
		Array.from({ length: Math.max(last - first + 1, 0) }, (_, i) =>
			fetchPage(first + i),
		),
	);
	const offset = start - (first - 1) * TMDB_PAGE;
	const unique = () => {
		const seen = new Set();
		return pages
			.flatMap((p) => p.results ?? [])
			.slice(offset)
			.filter((r) => !seen.has(r.id) && seen.add(r.id));
	};
	let results = unique();
	const lastFetched = pages.at(-1);
	if (
		results.length < perPage &&
		lastFetched &&
		lastFetched.page < Math.min(lastFetched.total_pages, TMDB_MAX_PAGES)
	) {
		pages.push(await fetchPage(lastFetched.page + 1));
		results = unique();
	}
	results = results.slice(0, perPage);
	const total = Math.min(
		pages[0]?.total_results ?? 0,
		TMDB_MAX_PAGES * TMDB_PAGE,
	);
	return {
		results,
		totalPages: Math.max(1, Math.ceil(total / perPage)),
	};
}
