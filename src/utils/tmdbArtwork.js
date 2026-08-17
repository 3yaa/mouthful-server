const TMDB_IMG = "https://image.tmdb.org/t/p";

const MAX_ARTWORK = 12;

// vote_count breaks ties
const rank = (a, b) =>
	(b.vote_average ?? 0) - (a.vote_average ?? 0) ||
	(b.vote_count ?? 0) - (a.vote_count ?? 0);

// tmdb's own pick leads
function collect(list, primaryPath, size) {
	const paths = (list ?? [])
		.filter((image) => image.file_path)
		.sort(rank)
		.map((image) => image.file_path);
	if (primaryPath) paths.unshift(primaryPath);
	//
	const seen = new Set();
	return paths
		.filter((path) => !seen.has(path) && seen.add(path))
		.slice(0, MAX_ARTWORK)
		.map((path) => `${TMDB_IMG}/${size}${path}`);
}

// every poster/backdrop tmdb has, best first
export const getPosterUrls = (images, primaryPath, size = "w1280") =>
	collect(images?.posters, primaryPath, size);

export const getBackdropUrls = (images, primaryPath, size = "w1280") =>
	collect(images?.backdrops, primaryPath, size);
