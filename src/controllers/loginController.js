import dotenv from "dotenv";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

dotenv.config();

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // get ALL needed fields from database
    const result = await pool.query(
      "SELECT id, username, email, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const foundUser = result.rows[0];

    // compare password with hash from db
    const match = await bcrypt.compare(password, foundUser.password_hash);

    if (match) {
      const accessToken = jwt.sign(
        {
          id: foundUser.id,
          email: foundUser.email,
          username: foundUser.username,
        },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "15m" }
      );
      const refreshToken = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const hashedToken = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

      // get user agent and IP for tracking
      const userAgent = req.headers["user-agent"] || null;
      const ipAddress = req.ip || req.connection.remoteAddress || null;

      // insert new session into user_sessions table
      await pool.query(
        `INSERT INTO user_sessions 
        (user_id, refresh_token_hash, refresh_token_expires, user_agent, ip_address)
        VALUES ($1, $2, $3, $4, $5)`,
        [foundUser.id, hashedToken, expiresAt, userAgent, ipAddress]
      );

      res.cookie("jwt", refreshToken, {
        httpOnly: true,
        sameSite: "none",
        secure: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      }); //should be 30 days
      res.status(200).json({
        success: true,
        message: `User ${foundUser.username} is logged in`,
        accessToken: accessToken,
        user: {
          id: foundUser.id,
          username: foundUser.username,
          email: foundUser.email,
        },
      });
    } else {
      res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }
  } catch (error) {
    console.error("Error logging in: ", error);
    res.status(500).json({
      success: false,
      message: "Error logging in",
      error: error.message,
    });
  }
};
