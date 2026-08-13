import { getSteamGridLogos } from "../../utils/steamGridLogo.js";

export async function useSteamGridLogosAPI(req, res) {
	try {
		const logos = await getSteamGridLogos(req.query.title);
		res.status(200).json({
			success: true,
			data: {
				logo_url: logos[0] ?? null,
				logos,
			},
		});
	} catch (error) {
		console.error("SteamGridDB logo fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch logos from SteamGridDB",
			error: error.message,
		});
	}
}
