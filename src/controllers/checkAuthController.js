// import { pool } from "../config/db.js";

// export const checkAuth = async (req, res) => {
//   try {
//     const refreshToken = req.cookies.jwt;
//     const hashedToken = crypto
//       .createHash("sha256")
//       .update(refreshToken)
//       .digest("hex");

//     const result = await pool.query(
//       `SELECT u.id, u.username, u.email, s.refresh_token_expires
//        FROM user_sessions s
//        JOIN users u ON s.user_id = u.id
//        WHERE s.refresh_token_hash = $1
//        AND s.refresh_token_expires > NOW()
//        AND s.is_active = TRUE`,
//       [hashedToken]
//     );

//     if (result.rows.length === 0) {
//       return res.status(401).json({
//         success: false,
//         message: "Invalid or expired token",
//       });
//     }

//     const user = result.rows[0];

//     res.status(200).json({
//       success: true,
//       user: {
//         id: user.id,
//         username: user.username,
//         email: user.email,
//       },
//     });
//   } catch (error) {
//     console.error("Error checking auth: ", error);
//     res.status(500).json({
//       success: false,
//       message: "Error checking auth",
//       error: error.message,
//     });
//   }
// };
