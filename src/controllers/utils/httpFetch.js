const DEFAULT_MS = 15_000;

export function httpFetch(url, options = {}, ms = DEFAULT_MS) {
	return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}

// tmdb answers 429 when pressed -- wait it out before giving up
export async function fetchJson(url, tries = 3) {
	for (let attempt = 1; ; attempt++) {
		const r = await httpFetch(url);
		if (r.ok) return r.json();
		if (r.status !== 429 || attempt >= tries)
			throw Object.assign(new Error(`HTTP ${r.status}`), {
				status: r.status,
			});
		const wait = Math.min(
			Number(r.headers.get("retry-after")) || attempt,
			5,
		);
		await new Promise((done) => setTimeout(done, wait * 1000));
	}
}
