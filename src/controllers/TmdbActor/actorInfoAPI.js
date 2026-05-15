import dotenv from "dotenv";

dotenv.config();

export async function useTmdbCastAPI(req, res) {
  try {
    const { tmdbId } = req.query;
    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/tv/${tmdbId}/credits?api_key=${process.env.TMDB_API_KEY}`,
    );
    if (!tmdbRes.ok) throw new Error(`TMDB HTTP ${tmdbRes.status}`);
    const data = await tmdbRes.json();
    const cast = data.cast.slice(0, 12).map((m) => ({
      id: m.id,
      name: m.name,
      character: m.character,
      profile_path: m.profile_path ?? null,
    }));
    res.status(200).json({ success: true, cast });
  } catch (e) {
    console.error("Failed to fetch cast from TMDB: ", e);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cast from TMDB",
      error: e.message,
    });
  }
}

export async function useTmdbActorWorksAPI(req, res) {
  try {
    const { actorId } = req.query;
    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/person/${actorId}/combined_credits?api_key=${process.env.TMDB_API_KEY}`,
    );
    if (!tmdbRes.ok) throw new Error(`TMDB HTTP ${tmdbRes.status}`);
    const data = await tmdbRes.json();

    const seen = new Set();
    const works = data.cast
      .filter((w) => {
        const c = (w.character ?? "").toLowerCase();
        return (
          w.popularity > 0 &&
          w.character &&
          !c.includes("self") &&
          !c.includes("mc")
        );
      })
      .map((w) => ({
        id: w.id,
        title: w.title ?? w.name ?? "Unknown",
        poster_path: w.poster_path ?? null,
        media_type: w.media_type,
        popularity: w.popularity,
        date: w.release_date ?? w.first_air_date ?? "",
      }))
      .sort((a, b) => b.popularity - a.popularity)
      .filter((w) => {
        if (seen.has(w.title)) return false;
        seen.add(w.title);
        return true;
      })
      .slice(0, 40);

    res.status(200).json({ success: true, works });
  } catch (e) {
    console.error("Failed to fetch actor works from TMDB: ", e);
    res.status(500).json({
      success: false,
      message: "Failed to fetch actor works from TMDB",
      error: e.message,
    });
  }
}
