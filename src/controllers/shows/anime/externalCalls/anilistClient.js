import { httpFetch } from "../../../utils/httpFetch.js";

const ENDPOINT = "https://graphql.anilist.co";
// 30 req per min
const RATE_LIMIT = 30;
const WINDOW_MS = 60 * 1000;
// AniList response TTL
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_429_RETRIES = 3;
// oldest first
const recent = [];
const cache = new Map();
//
let queue = Promise.resolve();
//
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// enforces anilist limits -- so don't cache a false negative
async function takeSlot() {
	for (;;) {
		const now = Date.now();
		while (recent.length && now - recent[0] >= WINDOW_MS) recent.shift();
		if (recent.length < RATE_LIMIT) {
			recent.push(now);
			return;
		}
		await sleep(WINDOW_MS - (now - recent[0]) + 50);
	}
}

async function anilistCall(query, variables, attempt = 0) {
	await new Promise((resolve) => {
		queue = queue.then(takeSlot).then(resolve, resolve);
	});

	//
	const response = await httpFetch(ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});
	// retry
	if (response.status === 429 && attempt < MAX_429_RETRIES) {
		const retryAfter = Number(response.headers.get("retry-after") ?? 60);
		await sleep((retryAfter + 1) * 1000);
		return anilistCall(query, variables, attempt + 1);
	}
	// fail
	if (!response.ok) {
		const error = new Error(
			`AniList HTTP ${response.status}: ${await response.text()}`,
		);
		error.status = response.status;
		throw error;
	}
	// format data
	const json = await response.json();
	if (json.errors) {
		throw new Error(`AniList GraphQL: ${JSON.stringify(json.errors)}`);
	}
	return json.data;
}

export async function anilistRequest(
	query,
	variables,
	{ cacheKey, bypassCache = false } = {},
) {
	const key = JSON.stringify({ cacheKey, variables });
	//
	if (!bypassCache) {
		const hit = cache.get(key);
		if (hit && hit.expires > Date.now()) return hit.value;
	}

	const value = await anilistCall(query, variables);
	cache.set(key, { value, expires: Date.now() + CACHE_TTL });

	// prune cache
	if (cache.size > CACHE_MAX) {
		const now = Date.now();
		for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
		while (cache.size > CACHE_MAX) {
			cache.delete(cache.keys().next().value);
		}
	}

	return value;
}
