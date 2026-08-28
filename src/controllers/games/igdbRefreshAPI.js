import { makeIgdbRequestWithRety } from "./igdbInternal/igdbAPI.js";
import { getSteamGridLogos } from "../utils/steamGridLogo.js";

// refetch a single game/dlc by its IGDB id -- no duplicate filtering, so it can
export async function useIgdbRefreshAPI(req, res) {
	try {
		const igdbId = req.query.igdbId;
		const title = req.query.title;
		const query = `
      fields
        id, name,
        cover.image_id,
        expansions.id, expansions.name,
        first_release_date,
        involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
        screenshots.image_id;
      where id = ${igdbId};
      limit 1;
    `;
		// call
		const [response, presetLogos] = await Promise.all([
			makeIgdbRequestWithRety(query),
			title ? getSteamGridLogos(title) : Promise.resolve(null),
		]);
		if (!response.ok) {
			return res.status(response.status).json({
				success: false,
				message: `IGDB API error: ${response.statusText}`,
				error: "IGDB API failure",
			});
		}
		// data clean
		const data = await response.json();
		const game = (data || [])[0];
		if (!game) {
			return res.status(404).json({
				success: false,
				message: "Game not found in IGDB",
				error: "No game results",
			});
		}
		//
		const logos = presetLogos ?? (await getSteamGridLogos(game.name));

		const processedGame = {
			igdbId: game.id,
			title: game.name,
			released_year: game.first_release_date
				? new Date(game.first_release_date * 1000).getFullYear()
				: undefined,
			cover_url: game.cover
				? `https://images.igdb.com/igdb/image/upload/t_1080p/${game.cover.image_id}.jpg`
				: null,
			developer: (game.involved_companies || [])
				.filter((company) => company.developer)
				.map((company) => ({ name: company.company.name })),
			expansions: game.expansions,
			screenshot_urls: (game.screenshots || []).map((ss) => ({
				ss_url: `https://images.igdb.com/igdb/image/upload/t_1080p/${ss.image_id}.jpg`,
			})),
			logo_url: logos[0] ?? null,
			logos,
		};
		//
		res.status(200).json({
			success: true,
			data: processedGame,
		});
	} catch (error) {
		console.error("IGDB refresh fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch game from IGDB",
			error: error.message,
		});
	}
}
