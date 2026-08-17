import express from "express";
import { loginUser } from "../controllers/auth/loginController.js";
import { logoutUser } from "../controllers/auth/logoutController.js";
import { refreshToken } from "../controllers/auth/refreshTokenController.js";
import { registerUser } from "../controllers/auth/registerController.js";
import { validateLogin } from "../middleware/validateAuth.js";
import { validateRefreshTokenCookie } from "../middleware/validateAuth.js";
import { validateRegister, isEmailDup } from "../middleware/validateAuth.js";

const authRouter = express.Router();
// login
authRouter.post("/login", validateLogin, loginUser);
authRouter.get("/logout", logoutUser);
// get refresh
authRouter.get("/refresh", validateRefreshTokenCookie, refreshToken);
// register
authRouter.post("/register", validateRegister, isEmailDup, registerUser);

export { authRouter };
