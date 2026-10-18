import { httpFetch } from "./httpFetch.js";

const TMDB_PAGE = 20;
const TMDB_MAX_PAGES = 500;
const PAGE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 500;

const cache = new Map();

async function fetchPage(baseUrl, n) {
	const url = `${baseUrl}&page=${n}`;
	const hit = cache.get(url);
	if (hit && hit.expires > Date.now()) return hit.value;
	const r = await httpFetch(url);
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const value = await r.json();
	cache.delete(url);
	cache.set(url, { value, expires: Date.now() + PAGE_TTL });
	if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
	return value;
}

export async function tmdbPageSlice(baseUrl, page, perPage) {
	const lastOurs = Math.ceil((TMDB_MAX_PAGES * TMDB_PAGE) / perPage);
	const start = (Math.min(Math.max(page, 1), lastOurs) - 1) * perPage;
	const first = Math.floor(start / TMDB_PAGE) + 1;
	const last = Math.min(
		Math.floor((start + perPage - 1) / TMDB_PAGE) + 1,
		TMDB_MAX_PAGES,
	);
	const pages = await Promise.all(
		Array.from({ length: Math.max(last - first + 1, 0) }, (_, i) =>
			fetchPage(baseUrl, first + i),
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
		pages.push(await fetchPage(baseUrl, lastFetched.page + 1));
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

// popularity-sorted
export async function tmdbMergedSlice(baseUrls, page, perPage) {
	if (baseUrls.length === 1) return tmdbPageSlice(baseUrls[0], page, perPage);

	const firsts = await Promise.all(baseUrls.map((url) => fetchPage(url, 1)));
	// a co-production in two feeds counts twice -- the last page can run short
	const total = Math.min(
		firsts.reduce((sum, p) => sum + (p.total_results ?? 0), 0),
		TMDB_MAX_PAGES * TMDB_PAGE,
	);
	const totalPages = Math.max(1, Math.ceil(total / perPage));
	const end = Math.min(Math.max(page, 1), totalPages) * perPage;
	// one page spare for the repeats tmdb itself serves across pages
	const depth = Math.ceil(end / TMDB_PAGE) + 1;

	const feeds = await Promise.all(
		baseUrls.map(async (url, i) => {
			const last = Math.min(
				depth,
				firsts[i].total_pages ?? 1,
				TMDB_MAX_PAGES,
			);
			const rest = await Promise.all(
				Array.from({ length: Math.max(last - 1, 0) }, (_, k) =>
					fetchPage(url, k + 2),
				),
			);
			return [firsts[i], ...rest].flatMap((p) => p.results ?? []);
		}),
	);

	// tmdb's order is not quite its popularity field
	const heads = feeds.map(() => 0);
	const seen = new Set();
	const merged = [];
	while (merged.length < end) {
		let pick = -1;
		for (let i = 0; i < feeds.length; i++) {
			const head = feeds[i][heads[i]];
			if (!head) continue;
			const best = pick === -1 ? null : feeds[pick][heads[pick]];
			if (!best || (head.popularity ?? 0) > (best.popularity ?? 0))
				pick = i;
		}
		if (pick === -1) break;
		const item = feeds[pick][heads[pick]++];
		if (!seen.has(item.id)) {
			seen.add(item.id);
			merged.push(item);
		}
	}
	return { results: merged.slice(end - perPage, end), totalPages };
}
