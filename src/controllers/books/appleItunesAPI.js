import dotenv from "dotenv";
import { checkDuplicate } from "../../utils/checkDuplicate.js";

dotenv.config();

function extractCoverUrls(results) {
	return results
		.map((item) =>
			item.artworkUrl100
				? item.artworkUrl100.replace("100x100bb", "600x600bb")
				: null,
		)
		.filter(Boolean);
}

// calls open lib -- cause itune puts ebook release date, also get ol key
async function getOpenLibraryMatch(title, author) {
	try {
		const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&fields=key,title,first_publish_year&limit=1`;
		const res = await fetch(url, {
			headers: {
				"User-Agent": `Media Manager/0.3 (${process.env.PAGE_CONTACT})`,
			},
		});
		if (!res.ok) return null;
		const doc = (await res.json()).docs?.[0];
		if (!doc || doc.title?.toLowerCase() !== title.toLowerCase())
			return null;
		return {
			key: doc.key ? `${doc.key.split("/").pop()}` : null,
			first_publish_year: doc.first_publish_year ?? null,
		};
	} catch (e) {
		console.error("Open Library match lookup failed: ", e);
		return null;
	}
}

export async function useAppleItunesAPI(req, res) {
	try {
		const userId = req.user.id;
		const { query, limit } = req.query;
		const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=ebook&limit=${limit}`;
		// call
		const response = await fetch(url, { method: "GET" });
		if (!response.ok) {
			return res.status(response.status).json({
				success: false,
				message: `Apple Itunes API error: ${response.statusText}`,
				error: `Apple Itunes API failure`,
			});
		}
		const data = await response.json();
		const books = data.results || [];
		if (books.length === 0) {
			return res.status(404).json({
				success: false,
				message: "No book found in Apple Itunes",
			});
		}
		// process
		const matched = books[0];
		const cover_urls = extractCoverUrls(books);

		// second call: audiobook covers as backdrops
		let backdrop_urls = [];
		try {
			const audiobookUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=audiobook&limit=${limit}`;
			const audiobookResponse = await fetch(audiobookUrl, {
				method: "GET",
			});
			if (audiobookResponse.ok) {
				const audiobookData = await audiobookResponse.json();
				backdrop_urls = extractCoverUrls(audiobookData.results || []);
			}
		} catch (audiobookError) {
			console.error(
				"Apple Itunes audiobook fetch failed: ",
				audiobookError,
			);
		}

		const fallbackYear = matched.releaseDate
			? parseInt(matched.releaseDate.split("-")[0])
			: undefined;
		const olMatch = matched.artistName
			? await getOpenLibraryMatch(query, matched.artistName)
			: null;

		const processedBook = {
			key: olMatch?.key ?? `apple:${matched.trackId}`,
			title: matched.trackName,
			author_name: matched.artistName ? [matched.artistName] : [],
			first_publish_year: olMatch?.first_publish_year ?? fallbackYear,
			cover_urls,
			backdrop_urls,
		};

		const isDuplicate = await checkDuplicate(
			"books",
			"key",
			processedBook.key,
			userId,
		);
		if (isDuplicate) {
			return res.status(409).json({
				success: false,
				title: processedBook.title,
				count: 1,
				error: "Duplicate found",
			});
		}

		res.status(200).json({
			success: true,
			count: 1,
			data: [processedBook],
		});
	} catch (e) {
		console.error("Apple Itunes fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch book from Apple Itunes",
			error: e.message,
		});
	}
}
