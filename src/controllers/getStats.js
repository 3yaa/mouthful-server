import { pool } from "../config/db.js";

export const getStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
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
    );

    const stats = {};
    for (const row of result.rows) {
      if (stats[row.media] == null) {
        stats[row.media] = {};
      }
      stats[row.media][row.status] = Number(row.count);
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
