import dotenv from "dotenv";
import { pool } from "../../config/db.js";
import { httpFetch } from "./httpFetch.js";

dotenv.config();

const PROFILE_BASE = "https://image.tmdb.org/t/p/w342";

//
const APPEARANCE = /\b(?:her|him|them|it)?self\b/;
const HOST = /\bmc\b/;
const CREW_JOB = { director: "Director", creator: "Creator" };

// cast, crew, created_by
const toMember = (person, billing) => ({
	id: person.id,
	name: person.name,
	character: billing ?? person.character,
	profile_path: person.profile_path
		? `${PROFILE_BASE}${person.profile_path}`
		: null,
});

export async function useTmdbShowCastAPI(req, res) {
	try {
		const { tmdbId } = req.query;
		const tmdbRes = await httpFetch(
			`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=credits`,
		);
		if (!tmdbRes.ok) throw new Error(`TMDB HTTP ${tmdbRes.status}`);
		const data = await tmdbRes.json();
		const cast = (data.credits?.cast ?? [])
			.slice(0, 12)
			.map((m) => toMember(m));
		const creators = (data.created_by ?? []).map((c) =>
			toMember(c, "Creator"),
		);
		res.status(200).json({ success: true, cast, creators });
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
			const findRes = await httpFetch(
				`https://api.themoviedb.org/3/find/${imdbId}?api_key=${process.env.TMDB_API_KEY}&external_source=imdb_id`,
			);
			if (!findRes.ok)
				throw new Error(`TMDB find HTTP ${findRes.status}`);
			const findData = await findRes.json();
			const found = findData.movie_results?.[0];
			if (!found) throw new Error("Movie not found in TMDB");
			tmdbId = String(found.id);
			// put in the tmdb for legacy
			await pool.query(
				"UPDATE movies SET tmdb_id=$1 WHERE id=$2 AND user_id=$3",
				[tmdbId, movieId, req.user.id],
			);
		}

		const tmdbRes = await httpFetch(
			`https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${process.env.TMDB_API_KEY}`,
		);
		if (!tmdbRes.ok) throw new Error(`TMDB HTTP ${tmdbRes.status}`);
		const data = await tmdbRes.json();
		const cast = data.cast.slice(0, 12).map((m) => toMember(m));
		//
		const directors = data.crew
			.filter((c) => c.job === CREW_JOB.director)
			.map((d) => toMember(d, "Director"));
		res.status(200).json({ success: true, cast, directors });
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
		const { actorId, role } = req.query;
		const tmdbRes = await httpFetch(
			`https://api.themoviedb.org/3/person/${actorId}/combined_credits?api_key=${process.env.TMDB_API_KEY}`,
		);
		if (!tmdbRes.ok) throw new Error(`TMDB HTTP ${tmdbRes.status}`);
		const data = await tmdbRes.json();

		const seen = new Set();
		// a director's own movies and a creator's own series are crew credits
		const job = Object.hasOwn(CREW_JOB, role ?? "") ? CREW_JOB[role] : null;
		const credits = job
			? data.crew.filter((w) => w.job === job)
			: data.cast.filter((w) => {
					const c = (w.character ?? "").toLowerCase();
					return w.character && !APPEARANCE.test(c) && !HOST.test(c);
				});

		const works = credits
			.filter((w) => w.popularity > 0)
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
				const key = `${w.media_type}-${w.id}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});

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
