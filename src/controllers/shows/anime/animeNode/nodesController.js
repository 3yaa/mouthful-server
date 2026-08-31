import { pool } from "../../../../config/db.js";
import { convertShowToCamelCase } from "../../showControllers.js";
import { chainIdsOf } from "../utils/utilFunctions.js";
import { PARTS_JOIN, loadMarks, writeMark, applyRollup } from "./nodesStore.js";

const fail = (res, status, message) =>
	res.status(status).json({ success: false, message });

// PATCH /shows/:id/parts/:anilistId -- score, note and hidden for one part of an anime row
export const patchShowNode = async (req, res) => {
	const showId = req.params.id;
	const anilistId = req.params.anilistId;
	const userId = req.user.id;
	const { score, note, hidden, indirectUpdate } = req.body;

	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		// locks the row so the read-merge-write below cannot race another mark
		const { rows } = await client.query(
			`SELECT id, anilist_id, seasons FROM shows WHERE id=$1 AND user_id=$2 FOR UPDATE`,
			[showId, userId],
		);
		if (!rows.length) {
			await client.query("ROLLBACK");
			return fail(res, 404, "Show not found");
		}
		const show = rows[0];
		// the gate is the whole anime-only rule -- live-action rows simply have no marks
		if (show.anilist_id == null) {
			await client.query("ROLLBACK");
			return fail(res, 409, "That is not an anime show");
		}
		if (!chainIdsOf(show.seasons, show.anilist_id).has(anilistId)) {
			await client.query("ROLLBACK");
			return fail(res, 409, "That entry is not a part of this show");
		}

		const marks = await loadMarks(client, showId);
		const prev = marks.get(anilistId) ?? {
			mu: null,
			phi: null,
			note: null,
			hidden: false,
		};
		// only the keys actually sent move -- a note edit must not clear a score
		const next = {
			mu:
				score === undefined
					? prev.mu
					: score === null
						? null
						: score.mu,
			phi:
				score === undefined
					? prev.phi
					: score === null
						? null
						: score.phi,
			note: note === undefined ? prev.note : note || null,
			hidden: hidden === undefined ? !!prev.hidden : !!hidden,
		};
		await writeMark(client, showId, anilistId, next);
		marks.set(anilistId, next);

		await applyRollup(client, showId, show.seasons, marks);
		// a mark is the user touching the item, the same as a score or a note
		if (!indirectUpdate) {
			await client.query(`UPDATE shows SET last_updated=$1 WHERE id=$2`, [
				new Date(),
				showId,
			]);
		}

		const saved = await client.query(
			`SELECT s.*, p.parts FROM shows s ${PARTS_JOIN} WHERE s.id=$1`,
			[showId],
		);
		await client.query("COMMIT");

		return res.status(200).json({
			success: true,
			message: "Show part updated successfully",
			data: convertShowToCamelCase(saved.rows[0]),
		});
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {});
		console.error("Error updating show part: ", error);
		return res.status(500).json({
			success: false,
			message: "Error updating show part",
			error: error.message,
		});
	} finally {
		client.release();
	}
};
