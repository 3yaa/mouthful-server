import { anilistRequest } from "../shows/anime/externalCalls/anilistClient.js";
import { checkDuplicate } from "../utils/checkDuplicate.js";

// relevance puts the author ahead of the translators and letterers
const MANGA_FIELDS = `
  id
  status
  chapters
  averageScore
  title { romaji english }
  startDate { year }
  coverImage { extraLarge color }
  staff(sort: [RELEVANCE, ID], perPage: 8) {
    edges {
      role
      node { name { full } }
    }
  }
  relations {
    edges {
      relationType
      node {
        id
        type
        format
        title { romaji english }
      }
    }
  }
`;

// light novels share the MANGA type -- they belong with books
const SEARCH_QUERY = `
  query MangaSearch($search: String, $perPage: Int) {
    Page(perPage: $perPage) {
      media(search: $search, type: MANGA, sort: SEARCH_MATCH, format_in: [MANGA, ONE_SHOT]) {
        ${MANGA_FIELDS}
      }
    }
  }
`;

const BY_ID_QUERY = `
  query MangaById($id: Int) {
    Media(id: $id, type: MANGA) {
      ${MANGA_FIELDS}
    }
  }
`;

const AUTHOR_QUERY = `
  query AuthorWorks($search: String, $page: Int, $sort: [MediaSort]) {
    Staff(search: $search) {
      id
      name { full }
      staffMedia(type: MANGA, sort: $sort, page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        edges {
          staffRole
          node {
            id
            format
            status
            chapters
            popularity
            averageScore
            isAdult
            title { romaji english }
            startDate { year }
            coverImage { extraLarge color }
          }
        }
      }
    }
  }
`;

const AUTHOR_SORTS = {
	popular: ["POPULARITY_DESC"],
	recent: ["START_DATE_DESC"],
};

// a running serial has no final count, whatever anilist last guessed
const RUNNING = new Set(["RELEASING", "HIATUS", "NOT_YET_RELEASED"]);
const CREATOR_ROLE = /^(story|art|original)/i;
const MAX_CREATORS = 2;

const titleOf = (media) => media.title?.english || media.title?.romaji;

function creatorsOf(media) {
	const names = (media.staff?.edges ?? [])
		.filter((edge) => CREATOR_ROLE.test(edge.role ?? ""))
		.map((edge) => edge.node?.name?.full)
		.filter(Boolean);
	return [...new Set(names)].slice(0, MAX_CREATORS);
}

// anime and novel edges carry the same relation types
function neighbour(media, relationType) {
	const edge = (media.relations?.edges ?? []).find(
		(e) =>
			e.relationType === relationType &&
			e.node?.type === "MANGA" &&
			e.node.format !== "NOVEL",
	);
	return edge
		? { id: String(edge.node.id), title: titleOf(edge.node) }
		: null;
}

function assembleManga(media) {
	const prequel = neighbour(media, "PREQUEL");
	const sequel = neighbour(media, "SEQUEL");

	return {
		anilist_id: media.id,
		title: titleOf(media),
		author_name: creatorsOf(media),
		first_publish_year: media.startDate?.year ?? null,
		chapters: RUNNING.has(media.status) ? null : (media.chapters ?? null),
		rating: media.averageScore != null ? media.averageScore / 10 : null,
		cover: media.coverImage?.extraLarge
			? {
					url: media.coverImage.extraLarge,
					color: media.coverImage.color ?? "#000000",
				}
			: null,
		series:
			prequel || sequel
				? { title: null, position: null, total: null, prequel, sequel }
				: null,
	};
}

async function searchManga(title, perPage) {
	const data = await anilistRequest(
		SEARCH_QUERY,
		{ search: title, perPage },
		{ cacheKey: "MangaSearch" },
	);
	return data?.Page?.media ?? [];
}

async function mangaById(id, bypassCache = false) {
	const data = await anilistRequest(
		BY_ID_QUERY,
		{ id: Number(id) },
		{ cacheKey: "MangaById", bypassCache },
	);
	return data?.Media ?? null;
}

function shapeAuthorWorks(edges) {
	const byId = new Map();
	for (const { staffRole, node } of edges ?? []) {
		const role = String(staffRole ?? "").replace(/\s*\(.*\)$/, "");
		if (!node || node.isAdult || node.format === "NOVEL") continue;
		if (!CREATOR_ROLE.test(role)) continue;
		const known = byId.get(node.id);
		if (known) {
			if (!known.roles.includes(role)) known.roles.push(role);
			continue;
		}
		byId.set(node.id, {
			anilistId: node.id,
			title: titleOf(node),
			format: node.format ?? null,
			status: node.status ?? null,
			chapters: RUNNING.has(node.status) ? null : (node.chapters ?? null),
			startYear: node.startDate?.year ?? null,
			posterUrl: node.coverImage?.extraLarge ?? null,
			posterColor: node.coverImage?.color ?? null,
			popularity: node.popularity ?? 0,
			score: node.averageScore ?? null,
			roles: [role],
		});
	}
	return [...byId.values()].map(({ roles, ...work }) => ({
		...work,
		role: roles.join(", "),
	}));
}

// collection
export async function useAnilistMangaAPI(req, res) {
	try {
		const userId = req.user.id;
		const title = req.validated.title;
		const knownId = req.validated.anilistId;

		// skipped when a series jump already knows the id
		const media = knownId
			? await mangaById(knownId)
			: (await searchManga(title, 1))[0];
		if (!media) {
			return res.status(404).json({
				success: false,
				message: "No manga found in AniList",
			});
		}
		// check for duplicate
		const isDuplicate = await checkDuplicate(
			"manga",
			"anilist_id",
			media.id,
			userId,
		);
		if (isDuplicate) {
			return res.status(409).json({
				success: false,
				title: titleOf(media),
				anilistId: media.id,
				message: `Manga "${titleOf(media)}" already in your library`,
				error: "Duplicate found",
			});
		}

		res.status(200).json({
			success: true,
			data: assembleManga(media),
		});
	} catch (e) {
		console.error("AniList manga fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch manga from AniList",
			error: e.message,
		});
	}
}

// returns the top candidates
export async function useAnilistMangaMultiAPI(req, res) {
	try {
		const userId = req.user.id;
		const title = req.validated.title;

		const results = await searchManga(title, 6);
		const candidates = await Promise.all(
			results.map(async (media) => ({
				anilist_id: media.id,
				title: titleOf(media),
				author_name: creatorsOf(media),
				first_publish_year: media.startDate?.year ?? null,
				cover_url: media.coverImage?.extraLarge ?? null,
				isDuplicate: await checkDuplicate(
					"manga",
					"anilist_id",
					media.id,
					userId,
				),
			})),
		);

		res.status(200).json({
			success: true,
			data: candidates,
		});
	} catch (e) {
		console.error("AniList manga multi fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to search AniList",
			error: e.message,
		});
	}
}

// a reload wants the live count -- a finished serial is how ??? turns into a number
export async function useAnilistMangaRefreshAPI(req, res) {
	try {
		const media = await mangaById(req.validated.anilistId, true);
		if (!media) {
			return res.status(404).json({
				success: false,
				message: "No manga found in AniList",
			});
		}

		res.status(200).json({
			success: true,
			data: assembleManga(media),
		});
	} catch (e) {
		console.error("AniList manga refresh fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch manga from AniList",
			error: e.message,
		});
	}
}

// one page of an author's manga
export async function useAnilistAuthorAPI(req, res) {
	try {
		const { name, page, sort } = req.validated;

		const data = await anilistRequest(
			AUTHOR_QUERY,
			{ search: name, page, sort: AUTHOR_SORTS[sort] },
			{ cacheKey: "AuthorWorks" },
		).catch((e) => {
			if (e.status === 404) return null;
			throw e;
		});
		const staff = data?.Staff;
		if (!staff) {
			return res.status(404).json({
				success: false,
				message: `No author named ${name}`,
			});
		}

		res.status(200).json({
			success: true,
			author: { id: staff.id, name: staff.name?.full ?? name },
			works: shapeAuthorWorks(staff.staffMedia?.edges),
			page,
			hasMore: !!staff.staffMedia?.pageInfo?.hasNextPage,
		});
	} catch (e) {
		console.error("AniList author works fetch failed: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch author works from AniList",
			error: e.message,
		});
	}
}
