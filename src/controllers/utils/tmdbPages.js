import { fetchJson } from "./httpFetch.js";
import { ttlMemo } from "./ttlMemo.js";
import { getImdbRatings } from "../imdbRating/imdbRatingCache.js";

const TMDB_PAGE = 20;
const TMDB_MAX_PAGES = 500;
const PAGE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 500;

// a warm and a rated page read each list page once
const cachedPage = ttlMemo((url) => fetchJson(url), PAGE_TTL, CACHE_MAX);
const fetchPage = (baseUrl, n) => cachedPage(`${baseUrl}&page=${n}`);

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

// needs 200 votes at least
const RATED_POOL = 200;
const MIN_VOTES = 100;
// this only bounds how many wait at once
const LOOKUPS_AT_ONCE = 24;
// past this tmdb is down
const MAX_FAILED = 20;

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return out;
}

// warms pause while a rated page is being built
let building = 0;
let built = null;
let release = null;
const whenBuilt = () =>
	building === 0
		? null
		: (built ??= new Promise((resolve) => (release = resolve)));

// thinly voted and unrated titles drop out
export async function tmdbRatedSlice(baseUrls, page, perPage, imdbIdOf) {
	building++;
	try {
		return await rankPool(baseUrls, page, perPage, imdbIdOf);
	} finally {
		if (--building === 0 && built) {
			release();
			built = null;
		}
	}
}

async function rankPool(baseUrls, page, perPage, imdbIdOf) {
	const { results: pool } = await tmdbMergedSlice(baseUrls, 1, RATED_POOL);
	// undefined = the lookup failed, null = imdb has no entry
	let failed = 0;
	const imdbIds = await mapLimit(pool, LOOKUPS_AT_ONCE, async (item) => {
		if (failed > MAX_FAILED) return undefined;
		const imdbId = await imdbIdOf(item.id);
		if (imdbId === undefined) failed++;
		return imdbId;
	});
	if (failed > MAX_FAILED)
		throw new Error(`${failed} imdb id lookups failed`);
	const known = imdbIds.filter(Boolean);
	const ratings = known.length ? await getImdbRatings(known) : {};
	const byRating = (a, z) =>
		z.imdb.rating - a.imdb.rating || z.imdb.votes - a.imdb.votes;
	const scored = pool.map((item, i) => ({
		item,
		imdbId: imdbIds[i],
		imdb: ratings[imdbIds[i]] ?? null,
	}));
	// a card keeps the id it was ranked by if its details call fails
	const ranked = scored
		.filter(({ imdb }) => imdb?.votes >= MIN_VOTES)
		.sort(byRating)
		.map(({ item, imdbId }) => ({ ...item, imdbId }));
	//
	const dropped = [
		...scored
			.filter(({ imdb }) => imdb && imdb.votes < MIN_VOTES)
			.sort(byRating),
		...scored.filter(({ imdb, imdbId }) => !imdb && imdbId !== undefined),
	];
	const totalPages = Math.max(1, Math.ceil(ranked.length / perPage));
	const start = (Math.min(Math.max(page, 1), totalPages) - 1) * perPage;
	return {
		results: ranked.slice(start, start + perPage),
		totalPages,
		dropped,
	};
}

export const droppedRow = ({ item, imdbId, imdb }) => ({
	tmdbId: String(item.id),
	imdbId,
	title: item.title ?? item.name,
	poster_url: item.poster_path
		? `https://image.tmdb.org/t/p/w500${item.poster_path}`
		: null,
	imdbRating: imdb?.rating ?? null,
	votes: imdb?.votes ?? null,
});

// a popular first page readies its rated twin
// so a rated page never queues behind a warm
const WARM_AT_ONCE = 4;
const warmedAt = new Map();
let warming = false;
let nextWarm = null;

async function runWarms() {
	warming = true;
	while (nextWarm) {
		const { key, baseUrls, imdbIdOf } = nextWarm;
		nextWarm = null;
		if (Date.now() - (warmedAt.get(key) ?? 0) < PAGE_TTL) continue;
		warmedAt.set(key, Date.now());
		if (warmedAt.size > CACHE_MAX)
			warmedAt.delete(warmedAt.keys().next().value);
		try {
			const { results } = await tmdbMergedSlice(baseUrls, 1, RATED_POOL);
			await mapLimit(results, WARM_AT_ONCE, async (item) => {
				await whenBuilt();
				return imdbIdOf(item.id);
			});
		} catch {
			warmedAt.delete(key);
		}
	}
	warming = false;
}

export function warmRatedPool(baseUrls, imdbIdOf) {
	const key = baseUrls.join(" ");
	if (Date.now() - (warmedAt.get(key) ?? 0) < PAGE_TTL) return;
	nextWarm = { key, baseUrls, imdbIdOf };
	if (!warming) runWarms();
}
