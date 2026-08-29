import { pool } from "../../../config/db.js";
import { convertShowToCamelCase } from "../showControllers.js";
import { applyAnimeChain } from "./animeAPI.js";
import { activeAnimeCutIds } from "./utils/utilFunctions.js";

const idOf = (item) => Number(item?.anilistId);
const variantsOf = (item) =>
	Array.isArray(item?.variants) ? item.variants : [];

// film cuts are lifted from seasons and stored as subnodes
function findCut(seasons, chosenId) {
	for (let seasonIndex = 0; seasonIndex < seasons.length; seasonIndex++) {
		const season = seasons[seasonIndex];
		const activeItems = [
			season,
			...(season?.subNodes ?? []).filter(
				(subNode) => subNode?.kind === "film" && subNode.isMainLine,
			),
		];
		for (const active of activeItems) {
			const variants = variantsOf(active);
			if (idOf(active) === chosenId && variants.length) {
				return { seasonIndex, active, chosen: active, variants };
			}
			const chosen = variants.find(
				(variant) => idOf(variant) === chosenId,
			);
			if (chosen) return { seasonIndex, active, chosen, variants };
		}
	}
	return null;
}

function positionsOf(seasons) {
	return seasons.flatMap((season) => [
		season,
		...(season?.subNodes ?? []).filter(
			(subNode) => subNode?.kind === "sideStory",
		),
	]);
}

function progressAfterRebuild(current, seasons, cut, chosenId) {
	const positions = positionsOf(seasons);
	const currentId = Number(current.cur_season_index);
	const survived = positions.find((item) => idOf(item) === currentId);
	if (survived) {
		const maxEpisode = Number(survived.episode_count) || 0;
		return {
			seasonId: currentId,
			episode: maxEpisode
				? Math.min(current.cur_episode ?? 0, maxEpisode)
				: (current.cur_episode ?? 0),
		};
	}
	// move progress if cut was cur position
	if (currentId === idOf(cut.active)) {
		const chosenPosition = positions.find(
			(item) => idOf(item) === chosenId,
		);
		const fallback = seasons[Math.min(cut.seasonIndex, seasons.length - 1)];
		return {
			seasonId: idOf(chosenPosition ?? fallback) || null,
			episode: 0,
		};
	}

	const fallback = seasons[0];
	return { seasonId: idOf(fallback) || null, episode: 0 };
}

export async function selectAnimeCut(req, res) {
	let client;
	try {
		client = await pool.connect();
		const showId = req.params.id;
		const userId = req.user.id;
		const chosenId = req.body.chosenAnilistId;

		await client.query("BEGIN");
		const currentResult = await client.query(
			`SELECT * FROM shows WHERE id=$1 AND user_id=$2 FOR UPDATE`,
			[showId, userId],
		);
		if (!currentResult.rows.length) {
			await client.query("ROLLBACK");
			return res
				.status(404)
				.json({ success: false, message: "Show not found" });
		}

		const current = currentResult.rows[0];
		if (
			current.anilist_id == null ||
			current.tmdb_id == null ||
			!Array.isArray(current.seasons)
		) {
			await client.query("ROLLBACK");
			return res.status(409).json({
				success: false,
				message: "Cuts can only be selected for an anime show",
			});
		}

		const cut = findCut(current.seasons, chosenId);
		if (!cut) {
			await client.query("ROLLBACK");
			return res.status(409).json({
				success: false,
				message: "That entry is not an available cut for this show",
			});
		}
		if (cut.active === cut.chosen) {
			await client.query("COMMIT");
			return res.json({
				success: true,
				message: "Anime cut already selected",
				data: convertShowToCamelCase(current),
			});
		}

		// rebuild season json
		const groupIds = new Set([idOf(cut.active), ...cut.variants.map(idOf)]);
		const preferredCuts = activeAnimeCutIds(current.seasons).filter(
			(id) => !groupIds.has(id),
		);
		preferredCuts.push(chosenId);

		const rebuilt = {};
		const didRebuild = await applyAnimeChain(
			rebuilt,
			Number(current.tmdb_id),
			preferredCuts,
			false,
		);
		if (
			!didRebuild ||
			!Array.isArray(rebuilt.seasons) ||
			!rebuilt.seasons.length
		) {
			await client.query("ROLLBACK");
			return res.status(502).json({
				success: false,
				message: "Could not rebuild the anime chain for that cut",
			});
		}

		const progress = progressAfterRebuild(
			current,
			rebuilt.seasons,
			cut,
			chosenId,
		);
		const updated = await client.query(
			`UPDATE shows
			 SET seasons=$1, anilist_id=$2, cur_season_index=$3,
			     cur_episode=$4, last_updated=NOW()
			 WHERE id=$5 AND user_id=$6
			 RETURNING *`,
			[
				JSON.stringify(rebuilt.seasons),
				rebuilt.anilistId ?? current.anilist_id,
				progress.seasonId,
				progress.episode,
				showId,
				userId,
			],
		);
		await client.query("COMMIT");

		res.json({
			success: true,
			message: "Anime cut updated",
			data: convertShowToCamelCase(updated.rows[0]),
		});
	} catch (error) {
		await client?.query("ROLLBACK").catch(() => {});
		console.error("Anime cut update failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to update anime cut",
			error: error.message,
		});
	} finally {
		client?.release();
	}
}
