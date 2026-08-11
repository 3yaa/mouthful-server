const TMDB_IMG = "https://image.tmdb.org/t/p";

// how many to hand the picker -- ranked
const MAX_LOGOS = 12;

// determines whether logo is png or svg -- png wins
const isSvg = (path) => path?.toLowerCase().endsWith(".svg");

// english first then png then based voted
const rank = (logo) =>
	(logo.iso_639_1 === "en" ? 4 : 0) + (isSvg(logo.file_path) ? 0 : 2);

const toUrl = (path) =>
	`${TMDB_IMG}/${isSvg(path) ? "original" : "w500"}${path}`;

// every logo tmdb has, best first -- the client cycles these on add/reload
export function getLogoUrls(images) {
	return (images?.logos ?? [])
		.filter((logo) => logo.file_path)
		.sort(
			(a, b) =>
				rank(b) - rank(a) || (b.vote_average ?? 0) - (a.vote_average ?? 0),
		)
		.slice(0, MAX_LOGOS)
		.map((logo) => toUrl(logo.file_path));
}

// make transparent
export function getLogoUrl(images) {
	return getLogoUrls(images)[0] ?? null;
}
