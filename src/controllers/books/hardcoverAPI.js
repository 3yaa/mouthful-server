import dotenv from "dotenv";
import { checkDuplicate } from "../utils/checkDuplicate.js";
import { httpFetch } from "../utils/httpFetch.js";

dotenv.config();

const MIN_COVER_WIDTH = 160;
const MIN_COVER_HEIGHT = 270;

// hardcover charges per top-level field
const BURST = 5;
const REFILL_PER_SEC = 1;
const MAX_429_RETRIES = 3;
//
let queue = Promise.resolve();
let tokens = BURST;
let lastRefill = Date.now();
//
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function refill() {
	const now = Date.now();
	tokens = Math.min(
		BURST,
		tokens + ((now - lastRefill) * REFILL_PER_SEC) / 1000,
	);
	lastRefill = now;
}

async function takeToken() {
	for (;;) {
		refill();
		if (tokens >= 1) {
			tokens -= 1;
			return;
		}
		await sleep(Math.ceil(((1 - tokens) * 1000) / REFILL_PER_SEC) + 50);
	}
}

// gql query
async function gql(query, variables = {}, attempt = 0) {
	await new Promise((resolve) => {
		queue = queue.then(takeToken).then(resolve, resolve);
	});

	const res = await httpFetch("https://api.hardcover.app/v1/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: process.env.HARDCOVER_AUTH_TOKEN,
			"User-Agent": "hardcover-metadata-script",
		},
		body: JSON.stringify({ query, variables }),
	});

	// queue
	if (res.status === 429 && attempt < MAX_429_RETRIES) {
		const retryAfter = Number(res.headers.get("retry-after") ?? 1);
		tokens = 0;
		lastRefill = Date.now();
		await sleep((retryAfter + 1) * 1000);
		return gql(query, variables, attempt + 1);
	}

	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	}

	const json = await res.json();
	if (json.errors) {
		throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
	}
	return json.data;
}

// 1st call -- book

//
function cleanBookData(doc) {
	// contribution entries with no `contribution` role (or "Author") are the real authors the rest are illustrators / translators / narrators
	const authors = (doc.contributions ?? [])
		.filter(
			(contributon) =>
				!contributon.contribution ||
				contributon.contribution == "Author",
		)
		.map((contribution) => contribution.author?.name)
		.filter(Boolean);

	return {
		id: doc.id,
		title: doc.title,
		authors: authors.length ? authors : (doc.author_names ?? []),
		first_publish_year: doc.release_year ?? null,
		pages: doc.pages ?? null,
		rating: doc.rating ? Math.round(doc.rating * 200) / 100 : null,
		// thumbnail from the search doc (used by the multi-result picker)
		cover_url: doc.image?.url ?? null,
		// popularity, used only for ranking below then stripped before returning
		_score: (doc.users_count ?? 0) * 10 + (doc.ratings_count ?? 0) * 5,
	};
}

//
async function searchBooks(title, { perPage = 10 } = {}) {
	const data = await gql(
		`query SearchBooks($q: String!, $perPage: Int!) {
				search(query: $q, query_type: "Book", per_page: $perPage, page: 1) {
					results
				}
			}`,
		{ q: title, perPage },
	);
	const hits = data?.search?.results?.hits ?? [];
	return hits
		.map((hit) => cleanBookData(hit.document))
		.filter((book) => book.title && (book.authors.length > 0 || book.pages))
		.sort((a, z) => z._score - a._score);
}

// 2nd call -- series

// cached_image is jsonb: { url, width, height, color, color_name, id }
const coverInfo = (e) => {
	let img = e.cached_image;
	if (!img) return null;
	if (typeof img === "string") {
		try {
			img = JSON.parse(img);
		} catch {
			return null;
		}
	}
	if (!img?.url) return null;
	return {
		url: img.url,
		width: img.width ?? null,
		height: img.height ?? null,
		color: img.color ?? null,
	};
};

//
async function withSeries(book) {
	const data = await gql(
		`query BookDetails($id: Int!) {
			books(where: { id: { _eq: $id } }, limit: 1) {
				subtitle
				book_series {
					position
					details
					featured
					series { id name primary_books_count }
				}
				editions(limit: 50, order_by: { users_count: desc }) {
					cached_image
				}
			}
		}`,
		{ id: Number(book.id) },
	);
	const b = data?.books?.[0] ?? {};

	const { ...cleanBook } = book;

	// book covers -- every edition
	const seen = new Set();
	const allCovers = (b.editions ?? [])
		.map(coverInfo)
		.filter(Boolean)
		.filter((c) => !seen.has(c.url) && seen.add(c.url));

	const bigCovers = allCovers.filter(
		(c) =>
			(c.width ?? 0) >= MIN_COVER_WIDTH &&
			(c.height ?? 0) >= MIN_COVER_HEIGHT,
	);

	// keep the small ones only if nothing clears the threshold
	const covers = bigCovers.length ? bigCovers : allCovers;

	// one entry per series the book belongs to, each with its own position
	const series = (b.book_series ?? [])
		.map((s) => ({
			id: s.series?.id ?? null,
			series_title: s.series?.name ?? null,
			total: s.series?.primary_books_count ?? null,
			position: s.position ?? null,
			//
			details: s.details ?? null, // display string, can be a range like "1-2"
			featured: !!s.featured,
		}))
		.sort((a, z) => Number(z.featured) - Number(a.featured));

	return {
		...cleanBook,
		subtitle: b.subtitle ?? null,
		series,
		covers,
	};
}

// 3rd call -- series details

const PER_SERIES_LIMIT = 200;
async function allNeighbours(seriesList) {
	const targets = seriesList.filter(
		(s) => s.id != null && s.position != null,
	);
	if (!targets.length) return {};
	// distinct_on needs its columns to lead order_by, so series_id sorts first -- a spent limit then drops whole series rather than inventing a neighbour
	const data = await gql(
		`query BatchNeighbours($ids: [Int!], $limit: Int!) {
			book_series(
				distinct_on: [series_id, position]
				order_by: [
					{ series_id: asc }
					{ position: asc }
					{ book: { users_count: desc } }
				]
				where: {
					series_id: { _in: $ids }
					compilation: { _eq: false }
					book: {
						canonical_id: { _is_null: true }
						is_partial_book: { _eq: false }
					}
				}
				limit: $limit
			) {
				series_id
				position
				book { title }
			}
		}`,
		{
			ids: targets.map((s) => Number(s.id)),
			limit: targets.length * PER_SERIES_LIMIT,
		},
	);
	// bucket by series rather than leaning on the response ordering
	const bySeries = new Map();
	for (const row of data?.book_series ?? []) {
		const rows = bySeries.get(row.series_id);
		if (rows) rows.push(row);
		else bySeries.set(row.series_id, [row]);
	}
	//
	const out = {};
	for (const s of targets) {
		const rows = bySeries.get(Number(s.id)) ?? [];
		// neighbours by list index, not position ± 1 — positions can be non-contiguous (novellas land at 1.5, numbering has gaps)
		const idx = rows.findIndex((r) => r.position === s.position);
		out[s.id] = {
			previous: idx > 0 ? (rows[idx - 1].book?.title ?? null) : null,
			next:
				idx >= 0 && idx < rows.length - 1
					? (rows[idx + 1].book?.title ?? null)
					: null,
		};
	}
	return out;
}

// collection
export async function useHardcoverAPI(req, res) {
	try {
		const userId = req.user.id;
		const title = req.query.title;

		// {id, title, author, first_publish_year, pages, rating}
		const [book] = await searchBooks(title);
		if (!book) {
			return res.status(404).json({
				success: false,
				message: "No book found in Hardcover",
			});
		}
		// check for duplicate
		const isDuplicate = await checkDuplicate(
			"books",
			"key",
			String(book.id),
			userId,
		);
		if (isDuplicate) {
			return res.status(409).json({
				success: false,
				title: book.title,
				error: "Duplicate found",
			});
		}

		const processedBook = await assembleBook(book);
		res.status(200).json({
			success: true,
			data: processedBook,
		});
	} catch (e) {
		console.error("Hardcover fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch book from Hardcover",
			error: e.message,
		});
	}
}

// returns the top candidates
export async function useHardcoverMultiAPI(req, res) {
	try {
		const userId = req.user.id;
		const title = req.query.title;

		const results = await searchBooks(title);
		const candidates = await Promise.all(
			results.slice(0, 6).map(async (b) => ({
				key: String(b.id),
				title: b.title,
				author_name: b.authors,
				first_publish_year: b.first_publish_year,
				cover_url: b.cover_url,
				isDuplicate: await checkDuplicate(
					"books",
					"key",
					String(b.id),
					userId,
				),
			})),
		);

		res.status(200).json({
			success: true,
			data: candidates,
		});
	} catch (e) {
		console.error("Hardcover multi fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to search Hardcover",
			error: e.message,
		});
	}
}

// direct lookup by hardcover book id -- used to reload an existing library
async function bookById(id) {
	const data = await gql(
		`query BookById($id: Int!) {
			books(where: { id: { _eq: $id } }, limit: 1) {
				id
				title
				release_year
				pages
				rating
				contributions { contribution author { name } }
			}
		}`,
		{ id: Number(id) },
	);
	const doc = data?.books?.[0];
	if (!doc) return null;
	return cleanBookData(doc);
}

//  series/covers/neighbours enrichment
async function assembleBook(book) {
	// {subtitle, series_title, total, position/details, featured?}
	const fullBook = await withSeries(book);
	// {previous, next}
	if (fullBook.series.length) {
		const map = await allNeighbours(fullBook.series);
		for (const s of fullBook.series) {
			const n = map[s.id] ?? { previous: null, next: null };
			s.previous = n.previous;
			s.next = n.next;
		}
	}

	return {
		key: String(fullBook.id),
		title: fullBook.title,
		subtitle: fullBook.subtitle,
		author_name: fullBook.authors,
		first_publish_year: fullBook.first_publish_year,
		num_pages: fullBook.pages,
		rating: fullBook.rating,
		covers: fullBook.covers.map((c) => ({
			url: c.url,
			color: c.color ?? "#000000",
		})),
		series: fullBook.series.map((s) => ({
			series_title: s.series_title,
			total: s.total,
			position: s.position ? String(s.position) : null,
			prequel: s.previous,
			sequel: s.next,
			//
			details: s.details,
		})),
	};
}

// reload metadata for a book already in the library, keyed by hardcover id
export async function useHardcoverRefreshAPI(req, res) {
	try {
		const key = req.query.key;

		const book = await bookById(key);
		if (!book) {
			return res.status(404).json({
				success: false,
				message: "No book found in Hardcover",
			});
		}

		const processedBook = await assembleBook(book);
		res.status(200).json({
			success: true,
			data: processedBook,
		});
	} catch (e) {
		console.error("Hardcover refresh fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch book from Hardcover",
			error: e.message,
		});
	}
}
