import { httpFetch } from "../../../utils/httpFetch.js";
const ENDPOINT = "https://shikimori.io/api";

// 5 req per sec | 90 per min
const RPS_LIMIT = 5;
const RPS_WINDOW = 1000;
const RPM_LIMIT = 90;
const RPM_WINDOW = 60 * 1000;

// cache franchise for a week
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_429_RETRIES = 3;

// oldest first, one per window
const perSecond = [];
const perMinute = [];
const cache = new Map();

// for no ops
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prune = (stamps, window, now) => {
	while (stamps.length && now - stamps[0] >= window) stamps.shift();
};

// enforces shikimori limits -- so don't cache a false negative
async function takeSlot() {
	// wait it out
	for (;;) {
		const now = Date.now();
		prune(perSecond, RPS_WINDOW, now);
		prune(perMinute, RPM_WINDOW, now);

		if (perSecond.length < RPS_LIMIT && perMinute.length < RPM_LIMIT) {
			perSecond.push(now);
			perMinute.push(now);
			return;
		}

		// no op until limiter is gone
		let waitMs = 0;
		if (perSecond.length >= RPS_LIMIT)
			waitMs = Math.max(waitMs, RPS_WINDOW - (now - perSecond[0]));
		if (perMinute.length >= RPM_LIMIT)
			waitMs = Math.max(waitMs, RPM_WINDOW - (now - perMinute[0]));
		await sleep(waitMs + 50);
	}
}

async function send(path, attempt = 0) {
	await takeSlot();

	const res = await httpFetch(`${ENDPOINT}${path}`, {
		headers: {
			Accept: "application/json",
			"User-Agent": `mouthful-server/1.0 (+${process.env.PAGE_CONTACT})`,
		},
	});

	if (res.status === 429 && attempt < MAX_429_RETRIES) {
		const retryAfter = Number(res.headers.get("retry-after") ?? 60);
		await sleep((retryAfter + 1) * 1000);
		return send(path, attempt + 1);
	}
	if (!res.ok) {
		throw new Error(`Shikimori HTTP ${res.status}: ${await res.text()}`);
	}

	return res.json();
}

export async function shikimoriQuery(malId, bypassCache = false) {
	const path = `/animes/${Number(malId)}/franchise`;
	//
	if (!bypassCache) {
		const hit = cache.get(path);
		if (hit && hit.expires > Date.now()) return hit.value;
	}
	//
	const value = await send(path);
	cache.set(path, { value, expires: Date.now() + CACHE_TTL });

	// opportunistic prune
	if (cache.size > CACHE_MAX) {
		const now = Date.now();
		// delete expired
		for (const [key, entry] of cache) {
			if (entry.expires <= now) cache.delete(key);
		}
		// delete oldest
		while (cache.size > CACHE_MAX) {
			cache.delete(cache.keys().next().value);
		}
	}
	return value;
}
