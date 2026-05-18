import dotenv from "dotenv";
import { pool } from "../../config/db.js";

dotenv.config();

const PROFILE_BASE = "https://image.tmdb.org/t/p/w342";

export async function useTmdbShowCastAPI(req, res) {
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
			profile_path: m.profile_path
				? `${PROFILE_BASE}${m.profile_path}`
				: null,
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

export async function useTmdbMovieCastAPI(req, res) {
	try {
		let { tmdbId, imdbId, movieId } = req.query;

		// LEGACY -- SOME MOVIES DON'T HAVE tmdbId
		if (tmdbId === "-1") {
			const findRes = await fetch(
				`https://api.themoviedb.org/3/find/${imdbId}?api_key=${process.env.TMDB_API_KEY}&external_source=imdb_id`,
			);
			if (!findRes.ok)
				throw new Error(`TMDB find HTTP ${findRes.status}`);
			const findData = await findRes.json();
			const found = findData.movie_results?.[0];
			if (!found) throw new Error("Movie not found in TMDB");
			tmdbId = String(found.id);
			await pool.query("UPDATE movies SET tmdb_id=$1 WHERE id=$2", [
				tmdbId,
				movieId,
			]);
		}

		const tmdbRes = await fetch(
			`https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${process.env.TMDB_API_KEY}`,
		);
		if (!tmdbRes.ok) throw new Error(`TMDB HTTP ${tmdbRes.status}`);
		const data = await tmdbRes.json();
		const cast = data.cast.slice(0, 12).map((m) => ({
			id: m.id,
			name: m.name,
			character: m.character,
			profile_path: m.profile_path
				? `${PROFILE_BASE}${m.profile_path}`
				: null,
		}));
		res.status(200).json({ success: true, cast });
	} catch (e) {
		console.error("Failed to fetch movie cast from TMDB: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch movie cast from TMDB",
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
				poster_path: w.poster_path
					? `https://image.tmdb.org/t/p/w500${w.poster_path}`
					: null,
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
