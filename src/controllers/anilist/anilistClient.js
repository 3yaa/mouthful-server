const ENDPOINT = "https://graphql.anilist.co";

// confirmed from the x-ratelimit-limit header
const RATE_LIMIT = 30;
const WINDOW_MS = 60 * 1000;
// franchise TTL
const CACHE_TTL = 12 * 60 * 60 * 1000;
const MAX_429_RETRIES = 2;

// oldest first
const recent = [];
const cache = new Map();
// serialises slot-taking so concurrent callers cannot both see a free slot
let queue = Promise.resolve();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// blocks until the rolling window has room
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

async function send(query, variables, attempt = 0) {
	await new Promise((resolve) => {
		queue = queue.then(takeSlot).then(resolve, resolve);
	});

	const res = await fetch(ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});

	if (res.status === 429 && attempt < MAX_429_RETRIES) {
		const retryAfter = Number(res.headers.get("retry-after") ?? 60);
		await sleep((retryAfter + 1) * 1000);
		return send(query, variables, attempt + 1);
	}
	if (!res.ok) {
		throw new Error(`AniList HTTP ${res.status}: ${await res.text()}`);
	}

	const json = await res.json();
	if (json.errors) {
		throw new Error(`AniList GraphQL: ${JSON.stringify(json.errors)}`);
	}
	return json.data;
}

export async function anilistQuery(query, variables = {}) {
	const key = JSON.stringify({ query, variables });
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return hit.value;

	const value = await send(query, variables);
	cache.set(key, { value, expires: Date.now() + CACHE_TTL });

	// opportunistic prune -- keeps a long-lived process from growing unbounded
	if (cache.size > 500) {
		const now = Date.now();
		for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
	}
	return value;
}

//  "Steins;Gate" and "steins gate" compare equal
const normalise = (s) =>
	(s ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9぀-ヿ一-鿿]+/g, "")
		.trim();

// guards against AniList's loose SEARCH_MATCH
export function titleMatches(query, titles) {
	const q = normalise(query);
	if (!q) return false;

	return (titles ?? []).filter(Boolean).some((t) => {
		const c = normalise(t);
		if (!c) return false;
		return c === q || c.includes(q) || q.includes(c);
	});
}
