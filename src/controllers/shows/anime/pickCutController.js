import { pool } from "../../../config/db.js";
import { convertShowToCamelCase } from "../showControllers.js";
import { compareStartDate } from "./utils/utilFunctions.js";

const idOf = (item) => Number(item?.anilistId);
const variantsOf = (item) =>
	Array.isArray(item?.variants) ? item.variants : [];

function findCut(seasons, chosenId) {
	for (let i = 0; i < seasons.length; i++) {
		const active = seasons[i];
		const variants = variantsOf(active);
		if (idOf(active) === chosenId && variants.length) {
			return { index: i, active, chosen: active };
		}
		//
		const chosen = variants.find((variant) => idOf(variant) === chosenId);
		if (chosen) return { index: i, active, chosen };
	}
	return null;
}

function promoteCut(active, chosen) {
	const {
		subNodes = [],
		variants = [],
		position,
		number,
		sourceManga,
		...activeMedia
	} = active;
	const {
		variantKind: _variantKind,
		relationType: _relationType,
		isMainLine: _isMainLine,
		...chosenMedia
	} = chosen;

	const demoted = {
		...activeMedia,
		isMainLine: false,
		variantKind: "alternate_cut",
		relationType: "ALTERNATIVE",
	};
	const remaining = variants.filter(
		(variant) => idOf(variant) !== idOf(chosen),
	);

	return {
		...chosenMedia,
		isMainLine: true,
		subNodes,
		variants: [...remaining, demoted].sort(compareStartDate),
		position,
		number,
		...(sourceManga !== undefined ? { sourceManga } : {}),
	};
}

export async function selectAnimeCut(req, res) {
	let client;
	try {
		client = await pool.connect();
		const showId = req.params.id;
		const userId = req.user.id;
		const chosenId = req.body.chosenAnilistId;

		// find cur structure
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
		if (current.anilist_id == null || !Array.isArray(current.seasons)) {
			await client.query("ROLLBACK");
			return res.status(409).json({
				success: false,
				message: "Cuts can only be selected for an anime show",
			});
		}

		// find the cut picked
		const cut = findCut(current.seasons, chosenId);
		if (!cut) {
			await client.query("ROLLBACK");
			return res.status(409).json({
				success: false,
				message: "That entry is not an available cut for this show",
			});
		}

		// no-op if selecting the same cut
		if (cut.active === cut.chosen) {
			await client.query("COMMIT");
			return res.json({
				success: true,
				message: "Anime cut already selected",
				data: convertShowToCamelCase(current),
			});
		}

		// swap cut
		const seasons = [...current.seasons];
		seasons[cut.index] = promoteCut(cut.active, cut.chosen);

		// if progress needs moving
		const currentWasReplaced =
			current.cur_season_index === cut.active.anilistId;
		const nextSeason = currentWasReplaced
			? chosenId
			: current.cur_season_index;
		const nextEpisode = currentWasReplaced ? 0 : current.cur_episode;

		// update db
		const updated = await client.query(
			`UPDATE shows
			 SET seasons=$1, cur_season_index=$2,
			     cur_episode=$3, last_updated=NOW()
			 WHERE id=$4 AND user_id=$5
			 RETURNING *`,
			[JSON.stringify(seasons), nextSeason, nextEpisode, showId, userId],
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
