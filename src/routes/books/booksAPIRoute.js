import express from "express";
import { useOpenLibraryAPI } from "../../controllers/books/openLibraryAPI.js";
import { useGoogleBooksAPI } from "../../controllers/books/googleBooksAPI.js";
import { useWikidataAPI } from "../../controllers/books/wikidataAPI.js";
import {
	validateBooksAPI,
	validateSeriesAPI,
} from "../../middleware/books/validateBooksAPI.js";
import { useAppleItunesAPI } from "../../controllers/books/appleItunesAPI.js";

const booksAPIRouter = express.Router();

booksAPIRouter.get("/apple-itunes", validateBooksAPI, useAppleItunesAPI);
booksAPIRouter.get("/open-library", validateBooksAPI, useOpenLibraryAPI);
booksAPIRouter.get("/google-books", validateBooksAPI, useGoogleBooksAPI);
booksAPIRouter.get("/wikidata", validateSeriesAPI, useWikidataAPI);

export { booksAPIRouter };
