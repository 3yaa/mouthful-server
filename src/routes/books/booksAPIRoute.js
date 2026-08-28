import express from "express";
import { validateBooksAPI } from "../../middleware/books/validateBooksAPI.js";
import {
	useHardcoverAPI,
	useHardcoverRefreshAPI,
	useHardcoverMultiAPI,
} from "../../controllers/books/hardcoverAPI.js";

const booksAPIRouter = express.Router();

booksAPIRouter.get("/hardcover", validateBooksAPI, useHardcoverAPI);
booksAPIRouter.get("/hardcover-multi", validateBooksAPI, useHardcoverMultiAPI);
booksAPIRouter.get("/hardcover-refresh", useHardcoverRefreshAPI);

export { booksAPIRouter };
