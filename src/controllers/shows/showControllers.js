import { pool } from "../../config/db.js";

const convertShowToCamelCase = (show) => ({
	id: show.id,
	dateCreated: show.date_created,
	title: show.title,
	studio: show.studio,
	posterUrl: show.poster_url,
	backdropUrl: show.backdrop_url,
	logoUrl: show.logo_url,
	dateReleased: show.date_released,
	seasons: show.seasons,
	// Dual meaning, disambiguated by anilist_id:
	//   anime       -> seasons[].anilistId
	//   live-action -> array index into seasons
	// The anime spine is rebuilt from scratch on every refresh and can insert
	// entries mid-array, so a position would silently shift which part the user
	// is on. TMDB seasons never reorder, so an index is safe there.
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
	anilistMeta: show.anilist_meta,
	userId: show.user_id,
});

// The one place on the server that knows how cur_season_index is interpreted.
// Mirrors slotIndexOf/slotOf on the client. Every read goes through this rather
// than branching inline, so the two meanings cannot drift apart.
export const resolveSlot = (seasons, { curSeasonIndex, anilistId }) => {
	if (!Array.isArray(seasons)) return null;
	if (anilistId != null) {
		return seasons.find((s) => s.anilistId === curSeasonIndex) ?? null;
	}
	return seasons[curSeasonIndex ?? 0] ?? null;
};

// anime slots carry `episodes`, TMDB seasons carry `episode_count`
const episodeCount = (slot) => slot?.episodes ?? slot?.episode_count ?? 0;

export const getRandomShows = async (req, res) => {
	try {
		const userId = req.user.id;

		const result = await pool.query(
			`
      SELECT * FROM shows
      WHERE user_id=$1 AND status='Want to Watch'
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
			SELECT * FROM shows 
			WHERE user_id=$1 
			ORDER BY 
				CASE status
					WHEN 'Watching' THEN 1
					WHEN 'Want to Watch' THEN 2
          WHEN 'Completed' THEN 3
					WHEN 'Dropped' THEN 4
					ELSE 4
				END,
        CASE 
          WHEN status = 'Completed' THEN date_completed
          ELSE last_updated
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
			`SELECT * FROM shows WHERE id=$1 AND user_id=$2`,
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

// Whitelist, not a fallback map. The old `camelToSnakeMapping[key] || key` let
// any request-body key become a column name in the SET clause.
const COLUMNS = {
	title: "title",
	studio: "studio",
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
	anilistMeta: "anilist_meta",
};

const JSONB_COLUMNS = ["seasons", "anilistMeta"];

export const patchShow = async (req, res) => {
	try {
		const showId = req.params.id;
		const userId = req.user.id;
		const { indirectUpdate, ...cleanUpdates } = req.body;
		const updates = { ...cleanUpdates };

		if (!indirectUpdate) {
			updates.lastUpdated = new Date();
		}

		if (updates.score !== undefined) {
			if (updates.score === null) {
				updates.score_mu = null;
				updates.score_phi = null;
			} else {
				updates.score_mu = updates.score.mu;
				updates.score_phi = updates.score.phi;
			}
			delete updates.score;
		}

		// A refresh rebuilds the slot array from scratch. For anime there is
		// nothing to remap -- progress rides on the AniList id, so it follows
		// its part wherever that lands. All that is left is re-clamping the
		// episode, in case a split cour got merged or an entry lost episodes.
		if (Array.isArray(updates.seasons)) {
			const { rows } = await pool.query(
				`SELECT cur_season_index, cur_episode, anilist_id FROM shows WHERE id=$1 AND user_id=$2`,
				[showId, userId],
			);
			if (rows.length) {
				// a show can become anime in the same patch that rebuilds its
				// seasons, so prefer the incoming values
				const pick = (key, col) =>
					updates[key] !== undefined ? updates[key] : rows[0][col];
				const slot = resolveSlot(updates.seasons, {
					curSeasonIndex: pick("curSeasonIndex", "cur_season_index"),
					anilistId: pick("anilistId", "anilist_id"),
				});
				const maxEp = episodeCount(slot);
				const ep = updates.curEpisode ?? rows[0].cur_episode ?? 0;
				if (maxEp && ep > maxEp) updates.curEpisode = maxEp;
			}
		}

		// jsonb columns need the object serialised. anilistMeta no longer has to
		// land in the same update as seasons: side-story and film anchors carry
		// afterSlotAnilistId, resolved at render time, so they cannot go stale.
		for (const key of JSONB_COLUMNS) {
			if (updates[key] !== undefined) {
				updates[key] =
					updates[key] === null ? null : JSON.stringify(updates[key]);
			}
		}

		const keys = Object.keys(updates).filter((k) => COLUMNS[k]);
		if (!keys.length) {
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
		} RETURNING * 
		`;
		const result = await pool.query(query, values);

		if (result.rows.length === 0) {
			return res.status(404).json({
				success: false,
				message: "Show not found",
			});
		}

		const convertedShow = convertShowToCamelCase(result.rows[0]);

		res.status(200).json({
			success: true,
			message: "Show updated successfully",
			data: convertedShow,
		});
	} catch (error) {
		console.error("Error updating show: ", error);
		res.status(500).json({
			success: false,
			message: "Error updating show",
			error: error.message,
		});
	}
};

export const createShow = async (req, res) => {
	try {
		const userId = req.user.id;
		const {
			title,
			studio,
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
			anilistMeta,
		} = req.body;

		// anime starts at the first slot's AniList id, live-action at index 0
		const startingSeason =
			curSeasonIndex ??
			(anilistId != null ? (seasons?.[0]?.anilistId ?? null) : 0);

		const query = `
    INSERT INTO shows (
      title,
      studio,
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
      anilist_meta,
      user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
    ) RETURNING *
  `;
		const values = [
			title,
			studio,
			posterUrl,
			backdropUrl,
			logoUrl ?? null,
			dateReleased,
			seasons ? JSON.stringify(seasons) : null,
			startingSeason,
			curEpisode,
			status,
			scoreObj?.mu ?? null,
			scoreObj?.phi ?? null,
			dateCompleted,
			note,
			tmdbId,
			imdbId ?? null,
			anilistId ?? null,
			anilistMeta ? JSON.stringify(anilistMeta) : null,
			userId,
		];
		const result = await pool.query(query, values);

		const convertedShow = convertShowToCamelCase(result.rows[0]);

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

		// Handle foreign key constraints
		if (error.code === "23503") {
			return res.status(400).json({
				success: false,
				message:
					"Cannot delete show because it is referenced by other records",
			});
		}

		res.status(500).json({
			success: false,
			message: "Error deleting show",
			error: error.message,
		});
	}
};
