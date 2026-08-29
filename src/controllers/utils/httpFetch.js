const DEFAULT_MS = 15_000;

export function httpFetch(url, options = {}, ms = DEFAULT_MS) {
	return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}
