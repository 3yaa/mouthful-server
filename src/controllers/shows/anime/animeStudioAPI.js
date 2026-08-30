import { fetchStudioWorks } from "./externalCalls/anilistStudioAPI.js";
import { animeTitle } from "./utils/shapeAnimes.js";

// quarter precision -- anime is dated to a season, not a day
function startDateOf(date) {
	if (!Number.isInteger(date?.year)) return null;
	return Number.isInteger(date?.month)
		? `${date.year}-${String(date.month).padStart(2, "0")}`
		: String(date.year);
}

const MAX_WORKS = 48;

// one card per entry
export function shapeStudioWorks(nodes) {
	return (nodes ?? [])
		.filter((anime) => anime && !anime.isAdult && animeTitle(anime))
		.map((anime) => ({
			anilistId: anime.id,
			title: animeTitle(anime),
			titleRomaji: anime.title?.romaji ?? null,
			format: anime.format ?? "UNKNOWN",
			status: anime.status ?? null,
			episode_count: anime.episodes ?? null,
			duration: anime.duration ?? null,
			startDate: startDateOf(anime.startDate),
			posterUrl:
				anime.coverImage?.extraLarge ?? anime.coverImage?.large ?? null,
			posterColor: anime.coverImage?.color ?? null,
			popularity: anime.popularity ?? 0,
			score: anime.averageScore ?? null,
		}))
		.sort((a, b) => b.popularity - a.popularity)
		.slice(0, MAX_WORKS);
}

export async function useAnimeStudioAPI(req, res) {
	try {
		const { studio } = req.query;
		const found = await fetchStudioWorks(studio);
		if (!found) {
			return res.status(404).json({
				success: false,
				message: `No studio named ${studio}`,
			});
		}

		const works = shapeStudioWorks(found.works);

		res.status(200).json({
			success: true,
			studio: { id: found.id, name: found.name },
			works,
		});
	} catch (e) {
		console.error("Failed to fetch studio works from AniList: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch studio works from AniList",
			error: e.message,
		});
	}
}
