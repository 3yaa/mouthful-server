import dotenv from "dotenv";
import { getImdbRatings } from "../imdbRatingsAPI.js";

dotenv.config();

function buildMonthUrl(year, month, countryOrigin) {
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const country = countryOrigin ? `&with_origin_country=${countryOrigin}` : "";
  return `https://api.themoviedb.org/3/discover/tv?api_key=${process.env.TMDB_API_KEY}${country}&first_air_date.gte=${year}-${pad(month)}-01&first_air_date.lte=${year}-${pad(month)}-${lastDay}&sort_by=popularity.desc`;
}

function buildEndedUrl(countryOrigin) {
  const country = countryOrigin ? `&with_origin_country=${countryOrigin}` : "";
  return `https://api.themoviedb.org/3/discover/tv?api_key=${process.env.TMDB_API_KEY}${country}&with_status=2&sort_by=popularity.desc`;
}

const toDay = (date) =>
  new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
  });

export async function useTmdbTvDiscoverAPI(req, res) {
  try {
    const { year, month, countryOrigin, page, isFuture } = req.query;

    // TO GET TMDBID AND POPULARITY SORT
    const baseUrl = isFuture
      ? buildEndedUrl(countryOrigin)
      : buildMonthUrl(year, month, countryOrigin);
    const discoverRes = await fetch(`${baseUrl}&page=${page}`);
    if (!discoverRes.ok) throw new Error(`HTTP ${discoverRes.status}`);
    const data = await discoverRes.json();
    const rawShows = data.results || [];
    const totalPages = Math.min(data.total_pages ?? 1, 100);

    // ACTUALLY GET ALL THE DATAFIELDS
    const details = await Promise.all(
      rawShows.map((s) =>
        fetch(
          `https://api.themoviedb.org/3/tv/${s.id}?api_key=${process.env.TMDB_API_KEY}&append_to_response=external_ids`,
        )
          .then((r) => r.json())
          .then((d) => {
            const days = [
              ...new Set(
                [
                  d.last_episode_to_air?.air_date,
                  d.next_episode_to_air?.air_date,
                ]
                  .filter(Boolean)
                  .map(toDay),
              ),
            ];
            return {
              id: s.id,
              episodes: d.number_of_episodes ?? null,
              airDay: days.length > 0 ? days.join(" & ") : null,
              currentEp: d.last_episode_to_air?.episode_number ?? null,
              imdbId: d.external_ids?.imdb_id ?? null,
            };
          })
          .catch(() => ({
            id: s.id,
            episodes: null,
            airDay: null,
            currentEp: null,
            imdbId: null,
          })),
      ),
    );

    const detailsMap = Object.fromEntries(details.map((d) => [d.id, d]));

    // GETS THE IMDB RATINGS
    const imdbIds = details.map((d) => d.imdbId).filter(Boolean);
    const imdbRes = imdbIds.length ? await getImdbRatings(imdbIds) : {};

    // ASSEMBLE
    const assembled = rawShows.map((s) => {
      const d = detailsMap[s.id];
      return {
        tmdbId: String(s.id),
        title: s.name,
        poster_url: s.poster_path
          ? `https://image.tmdb.org/t/p/w500${s.poster_path}`
          : null,
        first_air_date: s.first_air_date,
        imdbId: d.imdbId ?? "",
        imdbRating: d.imdbId ? (imdbRes[d.imdbId]?.rating ?? null) : null,
        currentEp: d.currentEp,
        totalEp: d.episodes,
        airDays: d.airDay,
      };
    });

    res
      .status(200)
      .json({ success: true, data: { shows: assembled, totalPages } });
  } catch (error) {
    console.error("TMDB-TV discover fetch failed: ", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch shows from TMDB-TV discover",
      error: error.message,
    });
  }
}
