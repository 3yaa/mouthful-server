const TMDB_IMG = "https://image.tmdb.org/t/p";

// determines whether logo is png or svg -- png wins
const isSvg = (path) => path?.toLowerCase().endsWith(".svg");

// english first then png then based voted 
const rank = (logo) =>
	(logo.iso_639_1 === "en" ? 4 : 0) + (isSvg(logo.file_path) ? 0 : 2);

// make transparent
export function getLogoUrl(images) {
	const logos = (images?.logos ?? []).filter((logo) => logo.file_path);
	if (logos.length === 0) return null;

	const [best] = [...logos].sort(
		(a, b) =>
			rank(b) - rank(a) || (b.vote_average ?? 0) - (a.vote_average ?? 0),
	);

	return `${TMDB_IMG}/${isSvg(best.file_path) ? "original" : "w500"}${
		best.file_path
	}`;
}
