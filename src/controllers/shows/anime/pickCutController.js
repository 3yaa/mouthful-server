import { pool } from "../../../config/db.js";
import { convertShowToCamelCase } from "../showControllers.js";
import { applyAnimeChain } from "./animeAPI.js";
import { activeAnimeCutIds, idOf, positionsOf } from "./utils/utilFunctions.js";

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

function progressAfterRebuild(current, seasons, cut, chosenId) {
	// against the row's own hiddens
	const positions = positionsOf(seasons, current.hidden_sides);
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

async function attemptCut(showId, userId, chosenId) {
	// xmin is postgres's own per-row transaction id -- every update bumps it
	const { rows } = await pool.query(
		`SELECT *, xmin::text AS row_version FROM shows WHERE id=$1 AND user_id=$2`,
		[showId, userId],
	);
	if (!rows.length) {
		return {
			status: 404,
			body: { success: false, message: "Show not found" },
		};
	}

	const current = rows[0];
	if (current.anilist_id == null || !Array.isArray(current.seasons)) {
		return {
			status: 409,
			body: { success: false, message: "That is not an anime show" },
		};
	}
	if (current.tmdb_id == null) {
		return {
			status: 409,
			body: {
				success: false,
				message: "Cuts can only be selected for an anime show",
			},
		};
	}

	const cut = findCut(current.seasons, chosenId);
	if (!cut) {
		return {
			status: 409,
			body: {
				success: false,
				message: "That entry is not an available cut for this show",
			},
		};
	}
	if (cut.active === cut.chosen) {
		return {
			status: 200,
			body: {
				success: true,
				message: "Anime cut already selected",
				data: convertShowToCamelCase(current),
			},
		};
	}

	// rebuild season json
	const groupIds = new Set([idOf(cut.active), ...cut.variants.map(idOf)]);
	const preferredCuts = activeAnimeCutIds(current.seasons).filter(
		(id) => !groupIds.has(id),
	);
	preferredCuts.push(chosenId);

	// rebuild
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
		return {
			status: 502,
			body: {
				success: false,
				message: "Could not rebuild the anime chain for that cut",
			},
		};
	}

	const progress = progressAfterRebuild(
		current,
		rebuilt.seasons,
		cut,
		chosenId,
	);

	// compare and set
	const saved = await pool.query(
		`UPDATE shows
		 SET seasons=$1, anilist_id=$2, cur_season_index=$3, cur_episode=$4,
		     last_updated=NOW()
		 WHERE id=$5 AND user_id=$6 AND xmin::text=$7
		 RETURNING *`,
		[
			JSON.stringify(rebuilt.seasons),
			rebuilt.anilistId ?? current.anilist_id,
			progress.seasonId,
			progress.episode,
			showId,
			userId,
			current.row_version,
		],
	);
	if (!saved.rows.length) return { conflict: true };

	return {
		status: 200,
		body: {
			success: true,
			message: "Anime cut updated",
			data: convertShowToCamelCase(saved.rows[0]),
		},
	};
}

const MAX_ATTEMPTS = 2;
export async function selectAnimeCut(req, res) {
	try {
		const showId = req.params.id;
		const userId = req.user.id;
		const chosenId = req.body.chosenAnilistId;

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const outcome = await attemptCut(showId, userId, chosenId);
			if (!outcome.conflict) {
				return res.status(outcome.status).json(outcome.body);
			}
		}

		res.status(409).json({
			success: false,
			message:
				"The show changed while the cut was being applied, try again",
		});
	} catch (error) {
		console.error("Anime cut update failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to update anime cut",
			error: error.message,
		});
	}
}
