import { pool } from "../config/db.js";
import { PARTS_JOIN } from "./shows/anime/animeNode/nodesStore.js";

export const getStats = async (req, res) => {
	try {
		const userId = req.user.id;
		const recentLimit = Math.min(
			Math.max(parseInt(req.query.recentLimit) || 3, 0),
			10,
		);

		const [result, avgResult, recentResult] = await Promise.all([
			// status stats
			pool.query(
				`
			SELECT 'movies' AS media, status, COUNT(*) AS count 
				FROM movies WHERE user_id=$1 GROUP BY status
			UNION ALL
			SELECT 'books', status, COUNT(*) 
				FROM books WHERE user_id=$1 GROUP BY status
			UNION ALL
			SELECT 'shows', status, COUNT(*) 
				FROM shows WHERE user_id=$1 GROUP BY status
			UNION ALL
			SELECT 'games', status, COUNT(*) 
				FROM games WHERE user_id=$1 GROUP BY status
			UNION ALL
			SELECT 'manga', status, COUNT(*) 
				FROM manga WHERE user_id=$1 GROUP BY status
			`,
				[userId],
			),
			// avg score
			pool.query(
				`
      SELECT 'movies' AS media, ROUND(AVG(score_mu / 200.0)::numeric, 1) AS avg_score
        FROM movies WHERE user_id=$1 AND score_mu IS NOT NULL
      UNION ALL
      SELECT 'books', ROUND(AVG(score_mu / 200.0)::numeric, 1)
        FROM books WHERE user_id=$1 AND score_mu IS NOT NULL
      UNION ALL
      SELECT 'shows', ROUND(AVG(score_mu / 200.0)::numeric, 1)
        FROM shows WHERE user_id=$1 AND score_mu IS NOT NULL
      UNION ALL
      SELECT 'games', ROUND(AVG(score_mu / 200.0)::numeric, 1)
        FROM games WHERE user_id=$1 AND score_mu IS NOT NULL
      UNION ALL
      SELECT 'manga', ROUND(AVG(score_mu / 200.0)::numeric, 1)
        FROM manga WHERE user_id=$1 AND score_mu IS NOT NULL
      `,
				[userId],
			),
			// most recent update
			pool.query(
				`
      (SELECT 'movies' AS media, id, title, score_mu, score_phi, status, cover->>'url' AS image_url, last_updated,
          NULL::jsonb AS seasons, NULL::integer AS cur_season_index,
          NULL::smallint AS cur_episode, NULL::integer AS anilist_id, NULL::jsonb AS parts,
          NULL::integer AS cur_chapter, NULL::integer AS chapters
        FROM movies WHERE user_id=$1
        ORDER BY last_updated DESC LIMIT $2)
      UNION ALL
      (SELECT 'books', id, title, score_mu, score_phi, status, cover->>'url', last_updated,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL
        FROM books WHERE user_id=$1
        ORDER BY last_updated DESC LIMIT $2)
      UNION ALL
      (SELECT 'shows', s.id, s.title, s.score_mu, s.score_phi, s.status, s.poster_url, s.last_updated,
          s.seasons, s.cur_season_index, s.cur_episode, s.anilist_id, p.parts, NULL, NULL
        FROM shows s ${PARTS_JOIN}
        WHERE s.user_id=$1
        ORDER BY s.last_updated DESC LIMIT $2)
      UNION ALL
      (SELECT 'games', id, title, score_mu, score_phi, status, cover->>'url', last_updated,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL
        FROM games WHERE user_id=$1
        ORDER BY last_updated DESC LIMIT $2)
      UNION ALL
      (SELECT 'manga', id, title, score_mu, score_phi, status, cover->>'url', last_updated,
          NULL, NULL, NULL, anilist_id, NULL, cur_chapter, chapters
        FROM manga WHERE user_id=$1
        ORDER BY last_updated DESC LIMIT $2)
      `,
				[userId, recentLimit],
			),
		]);

		// num items
		const stats = {};
		for (const row of result.rows) {
			if (stats[row.media] == null) {
				stats[row.media] = {};
			}
			stats[row.media][row.status] = Number(row.count);
		}
		// avg score
		for (const row of avgResult.rows) {
			// AVG over no scored rows is NULL, not 0
			if (stats[row.media] && row.avg_score != null) {
				stats[row.media].avgScore = Number(row.avg_score);
			}
		}
		//
		const recent = {};
		for (const row of recentResult.rows) {
			recent[row.media] ??= [];
			recent[row.media].push({
				// what a deep link off the landing page opens the row on
				id: row.id,
				title: row.title,
				score:
					row.score_mu != null
						? { mu: row.score_mu, phi: row.score_phi }
						: null,
				status: row.status,
				imageUrl: row.image_url,
				lastUpdated: row.last_updated,
				...(row.media === "shows" && {
					seasons: row.seasons,
					curSeasonIndex: row.cur_season_index,
					curEpisode: row.cur_episode,
					anilistId: row.anilist_id,
					parts: row.parts ?? null,
				}),
				...(row.media === "manga" && {
					curChapter: row.cur_chapter,
					chapters: row.chapters,
				}),
			});
		}

		res.json({
			success: true,
			data: stats,
			recent: recent,
		});
	} catch (error) {
		console.error("Error fetching stats: ", error);
		res.status(500).json({
			success: false,
			message: "Error fetching stats",
			error: error.message,
		});
	}
};
