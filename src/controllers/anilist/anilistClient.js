const ENDPOINT = "https://graphql.anilist.co";

// 30 req per min
const RATE_LIMIT = 30;
const WINDOW_MS = 60 * 1000;
// franchise TTL
const CACHE_TTL = 12 * 60 * 60 * 1000;
const MAX_429_RETRIES = 3;

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

//
export async function anilistQuery(
	query,
	variables = {},
	bypassCache = false,
) {
	const key = JSON.stringify({ query, variables });
	if (!bypassCache) {
		const hit = cache.get(key);
		if (hit && hit.expires > Date.now()) return hit.value;
	}

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
		// Decompose first, then drop the combining marks. TMDB writes macrons
		// where AniList spells the vowel out -- "Naruto Shippuden" with a u-macron
		// against "NARUTO: Shippuuden" -- and stripping the mark along with the
		// punctuation took the whole letter with it ("narutoshippden"), so the two
		// sides stopped matching and the show resolved to nothing. Kana keep their
		// voiced-sound marks: those decompose into the same range both sides are
		// normalised through, so they still compare equal.
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9぀-ヿ一-鿿]+/g, "")
		.trim();

// An exact title, which is a far stronger signal than the substring rule below
// and so is worth preferring when both are on offer. Searching for a series by
// a name a film also carries -- "Naruto Shippuden" is inside "Naruto Shippuden
// the Movie: Blood Prison" -- otherwise resolves to whichever SEARCH_MATCH
// ranked first, and a film has no seasons to walk.
export function titleEquals(query, titles) {
	const q = normalise(query);
	if (!q) return false;

	return (titles ?? []).filter(Boolean).some((t) => normalise(t) === q);
}

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
