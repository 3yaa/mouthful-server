import { pool } from "../../config/db.js";
import {
	PARTS_JOIN,
	applyRollup,
	loadMarks,
	pushRowScoreDown,
} from "./anime/animeNode/nodesStore.js";

export const convertShowToCamelCase = (show) => ({
	id: show.id,
	dateCreated: show.date_created,
	title: show.title,
	creator: show.creator,
	posterUrl: show.poster_url,
	backdropUrl: show.backdrop_url,
	logoUrl: show.logo_url,
	dateReleased: show.date_released,
	seasons: show.seasons,
	// normal: index number | anime: anilistId
	curSeasonIndex: show.cur_season_index,
	curEpisode: show.cur_episode,
	status: show.status,
	score:
		show.score_mu != null
			? { mu: show.score_mu, phi: show.score_phi }
			: null,
	dateCompleted: show.date_completed,
	lastUpdated: show.last_updated,
	note: show.note,
	tmdbId: show.tmdb_id,
	imdbId: show.imdb_id,
	anilistId: show.anilist_id,
	franchisePoster: show.franchise_poster,
	// keyed by anilist id
	parts: show.parts ?? null,
	userId: show.user_id,
});

// additional is apart of franchise -- films included
const positionsOf = (seasons) => [
	...seasons,
	...seasons.flatMap((slot) =>
		(slot.subNodes ?? []).filter(
			(sub) => sub.kind === "sideStory" || sub.kind === "film",
		),
	),
];

// normal show - index | anime - id
export const resolveSlot = (seasons, { curSeasonIndex, anilistId }) => {
	if (!Array.isArray(seasons) || !seasons.length) return null;
	// normal
	if (anilistId == null) {
		return seasons[curSeasonIndex ?? 0] ?? seasons[0];
	}
	// anime
	const found = positionsOf(seasons).find(
		(slot) => slot.anilistId === curSeasonIndex,
	);
	return found ?? seasons[0];
};

export const getRandomShows = async (req, res) => {
	try {
		const userId = req.user.id;

		const result = await pool.query(
			`
      SELECT s.*, p.parts FROM shows s ${PARTS_JOIN}
      WHERE s.user_id=$1 AND s.status='Want to Watch'
      ORDER BY RANDOM()
      LIMIT 10
      `,
			[userId],
		);

		const convertedShows = result.rows.map(convertShowToCamelCase);

		res.json({
			success: true,
			data: convertedShows,
		});
	} catch (error) {
		console.error("Error fetching random shows: ", error);
		res.status(500).json({
			success: false,
			message: "Error fetching random shows",
			error: error.message,
		});
	}
};

export const getShows = async (req, res) => {
	try {
		const userId = req.user.id;

		const result = await pool.query(
			`
			SELECT s.*, p.parts FROM shows s ${PARTS_JOIN}
			WHERE s.user_id=$1 
			ORDER BY 
				CASE s.status
					WHEN 'Watching' THEN 1
					WHEN 'Want to Watch' THEN 2
          WHEN 'Completed' THEN 3
					WHEN 'Dropped' THEN 4
					ELSE 4
				END,
        CASE 
          WHEN s.status = 'Completed' THEN s.date_completed
          ELSE s.last_updated
        END DESC
		`,
			[userId],
		);

		const convertedShows = result.rows.map(convertShowToCamelCase);

		res.json({
			success: true,
			count: convertedShows.length,
			data: convertedShows,
		});
	} catch (error) {
		console.error("Error fetching shows: ", error);
		res.status(500).json({
			success: false,
			message: "Error fetching shows",
			error: error.message,
		});
	}
};

export const getShow = async (req, res) => {
	try {
		const showId = req.params.id;
		const userId = req.user.id;
		const result = await pool.query(
			`SELECT s.*, p.parts FROM shows s ${PARTS_JOIN} WHERE s.id=$1 AND s.user_id=$2`,
			[showId, userId],
		);

		// if no show were found
		if (result.rows.length === 0) {
			return res.status(404).json({
				success: false,
				message: "Show not found",
			});
		}

		const convertedShow = convertShowToCamelCase(result.rows[0]);

		res.status(200).json({
			success: true,
			data: convertedShow,
		});
	} catch (error) {
		console.error("Error fetching show: ", error);
		res.status(500).json({
			success: false,
			message: "Error fetching show",
			error: error.message,
		});
	}
};

// api -> db
const COLUMNS = {
	title: "title",
	creator: "creator",
	posterUrl: "poster_url",
	backdropUrl: "backdrop_url",
	logoUrl: "logo_url",
	dateReleased: "date_released",
	seasons: "seasons",
	curSeasonIndex: "cur_season_index",
	curEpisode: "cur_episode",
	status: "status",
	score_mu: "score_mu",
	score_phi: "score_phi",
	dateCompleted: "date_completed",
	lastUpdated: "last_updated",
	note: "note",
	tmdbId: "tmdb_id",
	imdbId: "imdb_id",
	anilistId: "anilist_id",
	franchisePoster: "franchise_poster",
};

export const patchShow = async (req, res) => {
	const client = await pool.connect();
	try {
		const showId = req.params.id;
		const userId = req.user.id;
		const { indirectUpdate, ...cleanUpdates } = req.body;
		const updates = { ...cleanUpdates };

		if (!indirectUpdate) {
			updates.lastUpdated = new Date();
		}

		const scoreWritten = updates.score !== undefined;
		if (scoreWritten) {
			if (updates.score === null) {
				updates.score_mu = null;
				updates.score_phi = null;
			} else {
				updates.score_mu = updates.score.mu;
				updates.score_phi = updates.score.phi;
			}
			delete updates.score;
		}

		await client.query("BEGIN");

		// the ep clamp needs the cursor, the push-down needs the score it is replacing
		let before = null;
		if (scoreWritten || Array.isArray(updates.seasons)) {
			const { rows } = await client.query(
				`SELECT cur_season_index, cur_episode, anilist_id, score_mu, score_phi, seasons
				 FROM shows WHERE id=$1 AND user_id=$2 FOR UPDATE`,
				[showId, userId],
			);
			before = rows[0] ?? null;
		}

		// re-clamp ep in case a merge or a new entry
		if (Array.isArray(updates.seasons) && before) {
			// show can become anime in the same patch
			const pick = (key, col) =>
				updates[key] !== undefined ? updates[key] : before[col];
			const slot = resolveSlot(updates.seasons, {
				curSeasonIndex: pick("curSeasonIndex", "cur_season_index"),
				anilistId: pick("anilistId", "anilist_id"),
			});
			const maxEp = slot?.episode_count ?? 0;
			const ep = updates.curEpisode ?? before.cur_episode ?? 0;
			if (maxEp && ep > maxEp) updates.curEpisode = maxEp;
		}

		// the push-down weights parts by runtime, so it needs the chain as an array
		const chain = Array.isArray(updates.seasons)
			? updates.seasons
			: (before?.seasons ?? null);

		// jsonb columns need the object serialised
		if (updates["seasons"] !== undefined) {
			updates["seasons"] =
				updates["seasons"] === null
					? null
					: JSON.stringify(updates["seasons"]);
		}

		const keys = Object.keys(updates).filter((k) => COLUMNS[k]);
		if (!keys.length) {
			await client.query("ROLLBACK");
			return res.status(400).json({
				success: false,
				message: "No updatable fields provided",
			});
		}

		const setClause = keys
			.map((key, index) => `${COLUMNS[key]}=$${index + 1}`)
			.join(", ");
		const values = keys.map((key) => updates[key]);
		values.push(showId);
		values.push(userId);

		const query = `
		UPDATE shows
		SET ${setClause} WHERE id=$${values.length - 1} AND user_id=$${
			values.length
		} RETURNING id
		`;
		const result = await client.query(query, values);

		if (result.rows.length === 0) {
			await client.query("ROLLBACK");
			return res.status(404).json({
				success: false,
				message: "Show not found",
			});
		}

		// rolled up item is an oponnent
		if (scoreWritten && before?.anilist_id != null) {
			if (updates.score_mu != null) {
				await pushRowScoreDown(
					client,
					showId,
					chain,
					await loadMarks(client, showId),
					{ mu: before.score_mu, phi: before.score_phi },
					{ mu: updates.score_mu, phi: updates.score_phi },
				);
			}
			await applyRollup(
				client,
				showId,
				chain,
				await loadMarks(client, showId),
			);
		}

		const saved = await client.query(
			`SELECT s.*, p.parts FROM shows s ${PARTS_JOIN} WHERE s.id=$1`,
			[showId],
		);
		await client.query("COMMIT");

		const convertedShow = convertShowToCamelCase(saved.rows[0]);

		res.status(200).json({
			success: true,
			message: "Show updated successfully",
			data: convertedShow,
		});
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {});
		console.error("Error updating show: ", error);
		res.status(500).json({
			success: false,
			message: "Error updating show",
			error: error.message,
		});
	} finally {
		client.release();
	}
};

export const createShow = async (req, res) => {
	try {
		const userId = req.user.id;
		const {
			title,
			creator,
			posterUrl,
			backdropUrl,
			logoUrl,
			dateReleased,
			seasons,
			curSeasonIndex,
			curEpisode,
			status,
			score: scoreObj,
			dateCompleted,
			note,
			tmdbId,
			imdbId,
			anilistId,
			franchisePoster,
			parts,
		} = req.body;

		// anime -> first slot's AniList id | live-action -> index 0
		const startingSeason =
			curSeasonIndex ??
			(anilistId != null ? (seasons?.[0]?.anilistId ?? null) : 0);

		const query = `
    INSERT INTO shows (
      title,
      creator,
      poster_url,
      backdrop_url,
      logo_url,
      date_released,
      seasons,
      cur_season_index,
      cur_episode,
      status,
      score_mu,
      score_phi,
      date_completed,
      note,
      tmdb_id,
      imdb_id,
      anilist_id,
      franchise_poster,
      user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
    ) RETURNING *
  `;
		const values = [
			title,
			creator,
			posterUrl,
			backdropUrl,
			logoUrl ?? null,
			dateReleased,
			seasons ? JSON.stringify(seasons) : null,
			startingSeason,
			curEpisode ?? 0,
			status ?? "Want to Watch",
			scoreObj?.mu ?? null,
			scoreObj?.phi ?? null,
			dateCompleted,
			note,
			tmdbId,
			imdbId ?? null,
			anilistId ?? null,
			typeof franchisePoster === "boolean" ? franchisePoster : null,
			userId,
		];
		const result = await pool.query(query, values);
		const created = result.rows[0];

		// the add form can refuse a side entry before the row exists -- those marks ride in with it
		if (anilistId != null && parts && typeof parts === "object") {
			for (const [key, mark] of Object.entries(parts)) {
				const anilistId = Number(key);
				if (!Number.isSafeInteger(anilistId) || anilistId <= 0)
					continue;
				// a draft mark saying nothing is not a mark -- unhiding before the row exists leaves one
				if (mark?.score == null && !mark?.note && !mark?.hidden)
					continue;
				await pool.query(
					`INSERT INTO anime_nodes (show_id, anilist_id, score_mu, score_phi, note, hidden)
					 VALUES ($1,$2,$3,$4,$5,$6)
					 ON CONFLICT (show_id, anilist_id) DO NOTHING`,
					[
						created.id,
						anilistId,
						mark?.score?.mu ?? null,
						mark?.score?.phi ?? null,
						mark?.note ?? null,
						!!mark?.hidden,
					],
				);
			}
		}

		const saved = await pool.query(
			`SELECT s.*, p.parts FROM shows s ${PARTS_JOIN} WHERE s.id=$1`,
			[created.id],
		);
		const convertedShow = convertShowToCamelCase(saved.rows[0] ?? created);

		res.status(201).json({
			success: true,
			message: "Show Created Successfully",
			data: convertedShow,
		});
	} catch (error) {
		console.error("Error creating show: ", error);
		res.status(500).json({
			success: false,
			message: "Error creating show",
			error: error.message,
		});
	}
};

export const deleteShow = async (req, res) => {
	try {
		const showId = req.params.id;
		const userId = req.user.id;

		// delete show
		const result = await pool.query(
			"DELETE FROM shows WHERE id=$1 AND user_id=$2 RETURNING *",
			[showId, userId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({
				success: false,
				message: "Show not found",
			});
		}

		const convertedShow = convertShowToCamelCase(result.rows[0]);

		res.status(200).json({
			success: true,
			message: "Show deleted successfully",
			data: convertedShow,
		});
	} catch (error) {
		console.error("Error deleting show: ", error);

		res.status(500).json({
			success: false,
			message: "Error deleting show",
			error: error.message,
		});
	}
};
