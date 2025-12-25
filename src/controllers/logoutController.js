import dotenv from "dotenv";
import crypto from "crypto";
import { pool } from "../../src/config/db.js";

dotenv.config();

export const logoutUser = async (req, res) => {
  try {
    const cookies = req.cookies;
    if (!cookies?.jwt) return res.sendStatus(204);

    const refreshToken = cookies.jwt;
    const hashedToken = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    // delete session token
    await pool.query(
      "DELETE FROM user_sessions WHERE refresh_token_hash = $1 RETURNING id",
      [hashedToken]
    );

    res.clearCookie("jwt", { httpOnly: true, sameSite: "none", secure: true });
    res.sendStatus(204);
  } catch (error) {
    console.error("Error log out: ", error);
    res.status(500).json({
      success: false,
      message: "Error log out",
      error: error.message,
    });
  }
};
