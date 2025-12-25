import dotenv from "dotenv";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../../src/config/db.js";

dotenv.config();

export const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.jwt;
    const hashedToken = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    // get session and user info
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, s.refresh_token_expires, s.id as session_id
        FROM user_sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.refresh_token_hash = $1`,
      [hashedToken]
    );

    // forbidden
    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const foundUser = result.rows[0];
    const dateNow = new Date();

    // IF REFRESH TOKEN HAS EXPIRED
    if (new Date(foundUser.refresh_token_expires) < dateNow) {
      await pool.query("DELETE FROM user_sessions WHERE id = $1", [
        foundUser.session_id,
      ]);
      return res.status(403).json({
        success: false,
        message: "Refresh token expired",
      });
    }

    // update last_active_at timestamp
    await pool.query(
      "UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1",
      [foundUser.session_id]
    );

    // gen new access token
    const accessToken = jwt.sign(
      {
        id: foundUser.id,
        email: foundUser.email,
        username: foundUser.username,
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    res.status(200).json({
      success: true,
      accessToken: accessToken,
    });
  } catch (error) {
    console.error("Error Refresh token: ", error);
    res.status(500).json({
      success: false,
      message: "Error refresh token",
      error: error.message,
    });
  }
};
