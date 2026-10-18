export function ttlMemo(fn, ttl, max = 2000) {
	const cache = new Map();
	return (key) => {
		const hit = cache.get(key);
		if (hit && hit.expires > Date.now()) return hit.value;
		const value = fn(key).catch((error) => {
			if (cache.get(key)?.value === value) cache.delete(key);
			throw error;
		});
		cache.delete(key);
		cache.set(key, { value, expires: Date.now() + ttl });
		if (cache.size > max) cache.delete(cache.keys().next().value);
		return value;
	};
}
