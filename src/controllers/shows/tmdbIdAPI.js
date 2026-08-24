import dotenv from "dotenv";
import { checkDuplicate } from "../utils/checkDuplicate.js";

dotenv.config();

export async function useTmdbIdAPI(req, res) {
	try {
		const userId = req.user.id;
		const { title, year } = req.query;
		//
		const url = `https://api.themoviedb.org/3/search/tv?api_key=${
			process.env.TMDB_API_KEY
		}&query=${encodeURIComponent(title)}&first_air_date_year=${year}`;
		// make call
		const response = await fetch(url);
		if (!response.ok) {
			return res.status(response.status).json({
				success: false,
				message: `TMDB API error: ${response.statusText}`,
				error: `TMDB API failure`,
			});
		}
		//
		const data = await response.json();
		const show = data.results[0] || {};
		//
		const showData = {
			title: show.name,
			tmdbId: show.id,
		};
		// check duplicate
		const isDuplicate = await checkDuplicate(
			"shows",
			"tmdb_id",
			showData.tmdbId,
			userId,
		);
		if (isDuplicate) {
			return res.status(409).json({
				success: false,
				title: showData.title,
				message: `Show "${showData.title}" already in your library`,
				error: "Duplicate found",
			});
		}

		//
		res.status(200).json({
			success: true,
			data: showData,
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
