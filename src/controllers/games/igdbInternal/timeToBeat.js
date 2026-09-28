import { makeIgdbRequestWithRety } from "./igdbAPI.js";

// igdb id -> minutes; main story plus extras, else whichever figure players logged
export async function getTimesToBeat(igdbIds) {
	const ids = [...new Set(igdbIds.filter(Boolean))];
	if (!ids.length) return {};
	try {
		const response = await makeIgdbRequestWithRety(
			`fields game_id, hastily, normally, completely; where game_id = (${ids.join(",")}); limit ${ids.length};`,
			"game_time_to_beats",
		);
		if (!response.ok) return {};
		const rows = await response.json();
		return Object.fromEntries(
			(rows ?? []).map((row) => {
				const seconds = row.normally || row.hastily || row.completely;
				return [row.game_id, seconds ? Math.round(seconds / 60) : null];
			}),
		);
	} catch (error) {
		// a game is still worth adding without one
		console.error("IGDB time to beat failed: ", error.message);
		return {};
	}
}
