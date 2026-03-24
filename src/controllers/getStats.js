import { pool } from "../config/db.js";

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
			`,
        [userId],
      ),
      // avg score
      pool.query(
        `
				SELECT 'movies' AS media, ROUND(AVG(score), 1) AS avg_score
					FROM movies WHERE user_id=$1 AND score IS NOT NULL
				UNION ALL
				SELECT 'books', ROUND(AVG(score), 1)
					FROM books WHERE user_id=$1 AND score IS NOT NULL
				UNION ALL
				SELECT 'shows', ROUND(AVG(score), 1)
					FROM shows WHERE user_id=$1 AND score IS NOT NULL
				UNION ALL
				SELECT 'games', ROUND(AVG(score), 1)
					FROM games WHERE user_id=$1 AND score IS NOT NULL
			`,
        [userId],
      ),
      // most recent updated
      pool.query(
        `
				(SELECT 'movies' AS media, title, score, status, poster_url AS image_url, last_updated
					FROM movies WHERE user_id=$1
					ORDER BY last_updated DESC LIMIT $2)
				UNION ALL
				(SELECT 'books', title, score, cover_url, last_updated
					FROM books WHERE user_id=$1
					ORDER BY last_updated DESC LIMIT $2)
				UNION ALL
				(SELECT 'shows', title, score, poster_url, last_updated
					FROM shows WHERE user_id=$1
					ORDER BY last_updated DESC LIMIT $2)
				UNION ALL
				(SELECT 'games', title, score, poster_url, last_updated
					FROM games WHERE user_id=$1
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
      if (stats[row.media]) {
        stats[row.media].avgScore = Number(row.avg_score);
      }
    }
    //
    const recent = {};
    for (const row of recentResult.rows) {
      recent[row.media] ??= [];
      recent[row.media].push({
        title: row.title,
        score: row.score,
        imageUrl: row.image_url,
        lastUpdated: row.last_updated,
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
