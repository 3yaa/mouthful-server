import { pool } from "../config/db.js";

export const checkDuplicate = async (tableName, idName, id, userId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ${tableName} WHERE ${idName} = $1 AND user_id = $2 LIMIT 1`,
      [id, userId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error("Error checking for duplicate: ", error);
    throw error;
  }
};
