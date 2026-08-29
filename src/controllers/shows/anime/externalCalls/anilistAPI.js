const ANILIST_QUERY = `
  query FranchiseNodes($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id
        format
        source
        status
        episodes
        duration
        countryOfOrigin

        title { romaji english native }
        startDate { year month day }
        coverImage { extraLarge large color }

        studios {
          edges {
            isMain
            node { id name }
          }
        }

        relations {
          edges {
            relationType
            node {
              id
              type
              format
              title { romaji english native }
            }
          }
        }
      }
    }
  }
`;
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
// serialises slot-taking so concurrent callers cannot both see a free slot
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

async function anilistCall(ids, attempt = 0) {
	await new Promise((resolve) => {
		queue = queue.then(takeSlot).then(resolve, resolve);
	});

	//
	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			query: ANILIST_QUERY,
			variables: { ids },
		}),
	});
	// retry
	if (response.status === 429 && attempt < MAX_429_RETRIES) {
		const retryAfter = Number(response.headers.get("retry-after") ?? 60);
		await sleep((retryAfter + 1) * 1000);
		return anilistCall(ids, attempt + 1);
	}
	// fail
	if (!response.ok) {
		throw new Error(
			`AniList HTTP ${response.status}: ${await response.text()}`,
		);
	}
	// format data
	const json = await response.json();
	if (json.errors) {
		throw new Error(`AniList GraphQL: ${JSON.stringify(json.errors)}`);
	}
	return json.data;
}

async function anilistCallWrapper(ids, bypassCache = false) {
	const key = JSON.stringify({ ids });
	//
	if (!bypassCache) {
		const hit = cache.get(key);
		if (hit && hit.expires > Date.now()) return hit.value;
	}

	const value = await anilistCall(ids);
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

export async function fetchAnilist(ids = [], bypassCache = false) {
	const uniqueIds = [
		...new Set(
			[...ids].map(Number).filter((id) => Number.isInteger(id) && id > 0),
		),
	].sort((a, z) => a - z);
	if (uniqueIds.length === 0) return new Map();

	// create at most 50 IDs in one anilist call
	const chunks = [];
	for (let i = 0; i < uniqueIds.length; i += 50) {
		chunks.push(uniqueIds.slice(i, i + 50));
	}

	const responses = await Promise.all(
		chunks.map((ids) => anilistCallWrapper(ids, bypassCache)),
	);

	// map item id to lets payload
	const mediaById = new Map();
	for (const data of responses) {
		for (const media of data?.Page?.media ?? []) {
			mediaById.set(media.id, media);
		}
	}

	return mediaById;
}
