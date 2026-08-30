import { fetchStudioWorks } from "./externalCalls/anilistStudioAPI.js";
import { animeTitle } from "./utils/shapeAnimes.js";
import { isRecapOf } from "./buildRelations/classifyNodes.js";

const MIN_ROOT = 3;

const TITLE_TAIL = /[!?.]/;
const trimEdges = (value) => value.replace(/^[\s:\-–—~]+|[\s:\-–—~]+$/g, "");

// season, year
function startDateOf(date) {
	if (!Number.isInteger(date?.year)) return null;
	return Number.isInteger(date?.month)
		? `${date.year}-${String(date.month).padStart(2, "0")}`
		: String(date.year);
}

// -- title

const words = (title) =>
	String(title ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean);

// whole words, and a prefix
const opensWith = (longer, shorter) =>
	shorter.length > 0 &&
	shorter.length < longer.length &&
	shorter.every((word, i) => longer[i] === word);

function cutAfterWords(title, n) {
	let count = 0;
	let inWord = false;
	for (let i = 0; i < title.length; i++) {
		const isWord = /[a-z0-9]/i.test(title[i]);
		if (isWord && !inWord) {
			inWord = true;
			count++;
		} else if (!isWord && inWord) {
			inWord = false;
			if (count === n) return i;
		}
	}
	return count === n ? title.length : -1;
}

// drop main title from next item's
function splitAgainstSiblings(works) {
	const shaped = works.map((work) => ({ work, words: words(work.title) }));

	for (const entry of shaped) {
		let root = null;
		for (const other of shaped) {
			if (other === entry) continue;
			if (!opensWith(entry.words, other.words)) continue;
			if (!root || other.words.length < root.words.length) root = other;
		}
		let cut = root
			? cutAfterWords(entry.work.title, root.words.length)
			: -1;
		while (cut > 0 && TITLE_TAIL.test(entry.work.title[cut] ?? "")) cut++;
		const base = cut > 0 ? trimEdges(entry.work.title.slice(0, cut)) : "";
		const part = cut > 0 ? trimEdges(entry.work.title.slice(cut)) : "";
		// if two same
		const split = base.length >= MIN_ROOT && part.length > 0;
		entry.work.base = split ? base : entry.work.title;
		entry.work.part = split ? part : null;
	}

	return works;
}

function digestIdsIn(nodes) {
	const ids = new Set();
	for (const anime of nodes ?? []) {
		for (const edge of anime?.relations?.edges ?? []) {
			if (edge.relationType !== "SUMMARY") continue;
			if (!isRecapOf(edge.node, anime)) continue;
			ids.add(edge.node.id);
		}
	}
	return ids;
}

// one card per entry
export function shapeStudioWorks(nodes) {
	const digests = digestIdsIn(nodes);
	const shaped = (nodes ?? [])
		.filter((anime) => anime && !anime.isAdult && animeTitle(anime))
		.map((anime) => ({
			anilistId: anime.id,
			title: animeTitle(anime),
			titleRomaji: anime.title?.romaji ?? null,
			format: anime.format ?? "UNKNOWN",
			status: anime.status ?? null,
			episode_count: anime.episodes ?? null,
			duration: anime.duration ?? null,
			startDate: startDateOf(anime.startDate),
			posterUrl:
				anime.coverImage?.extraLarge ?? anime.coverImage?.large ?? null,
			posterColor: anime.coverImage?.color ?? null,
			popularity: anime.popularity ?? 0,
			score: anime.averageScore ?? null,
			isRecap: digests.has(anime.id),
		}));

	return splitAgainstSiblings(shaped);
}

export async function useAnimeStudioAPI(req, res) {
	try {
		const studio = String(req.query.studio ?? "").trim();
		const asked = parseInt(req.query.page, 10);
		const page = Number.isInteger(asked) && asked > 0 ? asked : 1;
		const sort = req.query.sort === "recent" ? "recent" : "popular";

		const found = await fetchStudioWorks(studio, { page, sort });
		if (!found) {
			return res.status(404).json({
				success: false,
				message: `No studio named ${studio}`,
			});
		}

		//
		const works = shapeStudioWorks(found.nodes).filter((work) =>
			found.pageIds.has(work.anilistId),
		);

		res.status(200).json({
			success: true,
			studio: { id: found.id, name: found.name },
			works,
			page,
			hasMore: found.hasNextPage,
		});
	} catch (e) {
		console.error("Failed to fetch studio works from AniList: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch studio works from AniList",
			error: e.message,
		});
	}
}
