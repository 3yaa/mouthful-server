import dotenv from "dotenv";
import { checkDuplicate } from "../../utils/checkDuplicate.js";

dotenv.config();

const MIN_COVER_WIDTH = 160;
const MIN_COVER_HEIGHT = 270;

// gql query
async function gql(query, variables = {}) {
	const res = await fetch("https://api.hardcover.app/v1/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: process.env.HARDCOVER_AUTH_TOKEN,
			"User-Agent": "hardcover-metadata-script",
		},
		body: JSON.stringify({ query, variables }),
	});

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
	// contribution entries with no `contribution` role (or "Author") are the real authors
	// the rest are illustrators / translators / narrators
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
		// stripped before the record is returned
		_compilation: !!doc.compilation,
		_score: (doc.users_count ?? 0) * 10 + (doc.ratings_count ?? 0) * 5, // arbitrary score for ranking/filtering only
	};
}

//
async function searchBooks(title, { perPage = 5 } = {}) {
	const data = await gql(
		`query SearchBooks($q: String!, $perPage: Int!) {
				search(query: $q, query_type: "Book", per_page: $perPage, page: 1) {
					results
				}
			}`,
		{ q: title, perPage },
	);
	const hits = data?.search?.results?.hits ?? [];
	return (
		hits
			.map((hit) => cleanBookData(hit.document))
			.filter(
				(book) =>
					book.title &&
					!book._compilation &&
					(book.authors.length > 0 || book.pages),
			)
			// text-match scores tie constantly; popularity breaks it toward the real record
			.sort((a, z) => z._score - a._score)
	);
}

// 2nd call -- series

// cached_image is jsonb: { url, width, height, color, color_name, id }
// It sometimes deserializes as a string depending on how it was stored.
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

	const { _compilation, _score, ...cleanBook } = book;

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

// canonical_id is Hardcover's duplicate/translation marker — records with one
// set point at a master record, so filtering for null gives the canonical book.
// is_partial_book excludes stubs. distinct_on collapses each position to one row.
async function allNeighbours(seriesList) {
	const targets = seriesList.filter(
		(s) => s.id != null && s.position != null,
	);
	if (!targets.length) return {};
	//
	const parts = targets.map(
		(s, i) => `
    s${i}: book_series(
      distinct_on: position
      order_by: [{ position: asc }, { book: { users_count: desc } }]
      where: {
        series_id: { _eq: ${Number(s.id)} }
        compilation: { _eq: false }
        book: {
          canonical_id: { _is_null: true }
          is_partial_book: { _eq: false }
        }
      }
      limit: 200
    ) {
      position
      book { title }
    }`,
	);
	const data = await gql(`query BatchNeighbours {${parts.join("\n")}}`);
	//
	const out = {};
	targets.forEach((s, i) => {
		const rows = data?.[`s${i}`] ?? [];
		// neighbours by list index, not position ± 1 — positions can be
		// non-contiguous (novellas land at 1.5, numbering has gaps)
		const idx = rows.findIndex((r) => r.position === s.position);
		out[s.id] = {
			previous: idx > 0 ? (rows[idx - 1].book?.title ?? null) : null,
			next:
				idx >= 0 && idx < rows.length - 1
					? (rows[idx + 1].book?.title ?? null)
					: null,
		};
	});
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

		const processedBook = {
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
