import { pool } from "../config/db.js";

export const getStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const [result, avgResult] = await Promise.all([
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

    res.json({
      success: true,
      data: stats,
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
