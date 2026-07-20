import dotenv from "dotenv";
import { checkDuplicate } from "../../utils/checkDuplicate.js";

dotenv.config();

export async function useOpenLibraryAPI(req, res) {
	try {
		const userId = req.user.id;
		const { query, limit } = req.query;
		const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
			query,
		)}&lang=en&fields=key,title,author_name,first_publish_year,subject,edition_key,cover_edition_key&limit=${limit}`;
		const headers = new Headers({
			"User-Agent": `Media Manager/0.3 (${process.env.PAGE_CONTACT})`,
		});
		const options = {
			method: "GET",
			headers: headers,
		};
		// make call
		const response = await fetch(url, options);
		if (!response.ok) {
			return res.status(response.status).json({
				success: false,
				message: `Open Library API error: ${response.statusText}`,
				error: `Open Library API failure`,
			});
		}
		// data clean up
		const data = await response.json();
		const books = data.docs || [];
		const processedBooks = books.map((book) => {
			const cover_urls = (book.edition_key || []).map((key) => {
				return `https://covers.openlibrary.org/b/olid/${key}-L.jpg`;
			});
			return {
				key: `ol:${book.key.split("/").pop()}`,
				title: book.title,
				author_name: book.author_name,
				first_publish_year: book.first_publish_year,
				cover_urls,
				backdrop_urls: cover_urls,
			};
		});
		// check all candidates for duplicates in parallel
		const dupChecks = await Promise.all(
			processedBooks.map(async (book) => ({
				book,
				isDuplicate: await checkDuplicate(
					"books",
					"key",
					book.key,
					userId,
				),
			})),
		);

		const dup = dupChecks.find((c) => c.isDuplicate);
		if (dup) {
			return res.status(409).json({
				success: false,
				title: dup.book.title,
				count: 1,
				error: "Duplicate found",
			});
		}

		const nonDuplicateBooks = dupChecks.map((c) => c.book);
		res.status(200).json({
			success: true,
			count: nonDuplicateBooks.length,
			data: nonDuplicateBooks,
		});
	} catch (error) {
		console.error("OpenLibrary fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch book from Open Library",
			error: error.message,
		});
	}
}
