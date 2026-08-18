import dotenv from "dotenv";
import { checkDuplicate } from "../utils/checkDuplicate.js";

dotenv.config();

// "Steins;Gate" and "steins gate" compare equal
const normalise = (s) =>
	(s ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9\u3000-\u30ff\u4e00-\u9fff]+/g, "");

// TMDB ranks an exact name match first no matter how dead the record is, and
// anime carry a romaji title that often belongs to a stub rather than to the
// series anyone means. Searching "Arslan Senki" put a 1995 entry with no
// poster and a popularity of 0.8 ahead of the 2015 series everybody wants.
//
// Order of business:
//   1. a record with no poster is a stub -- drop it unless that is all there is
//   2. an exact title match, on either the display or the original title
//   3. popularity, which separates a main series from its spin-offs
export function pickBestMatch(results, query) {
	if (!results?.length) return null;

	const withArt = results.filter((r) => r.poster_path);
	const pool = withArt.length ? withArt : results;

	const wanted = normalise(query);
	const rank = (r) => {
		const names = [r.name, r.original_name].map(normalise);
		if (names.includes(wanted)) return 0;
		if (names.some((n) => n && (n.startsWith(wanted) || wanted.startsWith(n))))
			return 1;
		return 2;
	};

	return [...pool].sort(
		(a, b) => rank(a) - rank(b) || (b.popularity ?? 0) - (a.popularity ?? 0),
	)[0];
}

export async function useTmdbSearchAPI(req, res) {
  try {
    const userId = req.user.id;
    const { title, year } = req.query;
    // an absent year arrived as the string "undefined" and rode along in the
    // query, which is harmless today only because tmdb ignores what it cannot
    // parse
    const hasYear = year && year !== "undefined" && !Number.isNaN(Number(year));
    const url =
      `https://api.themoviedb.org/3/search/tv?api_key=${process.env.TMDB_API_KEY}` +
      `&query=${encodeURIComponent(title)}` +
      (hasYear ? `&first_air_date_year=${Number(year)}` : "");
    // make call
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: `TMDB API error: ${response.statusText}`,
        error: `TMDB API failure`,
      });
    }
    // check if valid
    const data = await response.json();
    const show = pickBestMatch(data.results, title) || {};
    // data clean up
    const processedShow = {
      tmdbId: show.id,
      title: show.name,
      released_date: show.first_air_date,
      poster_url: show.poster_path
        ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
        : null,
      backdrop_url: show.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}`
        : null,
    };
    // check duplicate
    const isDuplicate = await checkDuplicate(
      "shows",
      "tmdb_id",
      processedShow.tmdbId,
      userId
    );
    if (isDuplicate) {
      return res.status(409).json({
        success: false,
        title: processedShow.title,
        message: `Show "${processedShow.title}" already in your library`,
        error: "Duplicate found",
      });
    }
    //
    res.status(200).json({
      success: true,
      data: processedShow,
    });
  } catch (error) {
    console.error("TMDB fetch failed: ", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch series from TMDB",
      error: error.message,
    });
  }
}
