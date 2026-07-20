import express from "express";
import { useOpenLibraryAPI } from "../../controllers/books/openLibraryAPI.js";
import { useGoogleBooksAPI } from "../../controllers/books/googleBooksAPI.js";
import { useWikidataAPI } from "../../controllers/books/wikidataAPI.js";
import { validateBooksAPI } from "../../middleware/books/validateBooksAPI.js";
import { useAppleItunesAPI } from "../../controllers/books/appleItunesAPI.js";
import { useHardcoverAPI } from "../../controllers/books/hardcoverAPI.js";

const booksAPIRouter = express.Router();

booksAPIRouter.get("/hardcover", validateBooksAPI, useHardcoverAPI);

// depricated
booksAPIRouter.get("/apple-itunes", useAppleItunesAPI);
booksAPIRouter.get("/open-library", useOpenLibraryAPI);
booksAPIRouter.get("/google-books", useGoogleBooksAPI);
booksAPIRouter.get("/wikidata", useWikidataAPI);

export { booksAPIRouter };
