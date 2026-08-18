import { anilistQuery, titleMatches } from "./anilistClient.js";
import {
	anilistIdOf,
	aodEntry,
	relatedKeys,
	tmdbRows,
} from "./animeIndex.js";
import { overridesFor } from "./animeOverrides.js";

// TMDB's own "anime" keyword
const TMDB_ANIME_KEYWORD = 210024;
const TMDB_ANIMATION_GENRE = 16;
const ANIME_ORIGINS = ["JP", "CN", "KR", "TW"];

// genre+origin
export function isAnime(tmdbDetail) {
	const genres = (tmdbDetail?.genres ?? []).map((g) => g.id);
	const keywords = (tmdbDetail?.keywords?.results ?? []).map((k) => k.id);
	if (keywords.includes(TMDB_ANIME_KEYWORD)) return true;

	const origins = tmdbDetail?.origin_country ?? [];
	return (
		genres.includes(TMDB_ANIMATION_GENRE) &&
		origins.some((c) => ANIME_ORIGINS.includes(c))
	);
}

// A special this long is a film in everything but its label. Attack on Titan's
// actual finale was never entered as a MOVIE anywhere -- it exists only as
// "THE FINAL CHAPTERS" Special 1 and 2, at 61 and 85 minutes.
const FEATURE_MINUTES = 45;

// AOD dates anime to a quarter, not a month. The ui only ever reads the year
// off these, so a representative month keeps the string sortable and the
// display exact.
const SEASON_MONTH = { WINTER: "01", SPRING: "04", SUMMER: "07", FALL: "10" };
const SEASON_ORDER = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };

const startDateOf = (entry) =>
	entry?.y ? `${entry.y}-${SEASON_MONTH[entry.q] ?? "01"}` : null;

const chronoKey = (entry) =>
	(entry?.y ?? 9999) * 4 + (SEASON_ORDER[entry?.q] ?? 0);

// Runtime decides, not the label. AniList files 7-minute promos and 5-minute
// stings as MOVIE, and they are not things to send someone off to watch; the
// same threshold rescues feature-length entries filed as SPECIAL.
const isFeature = (entry) => {
	if (!["MOVIE", "SPECIAL", "OVA"].includes(entry?.k)) return false;
	if ((entry.e ?? 1) > 1) return false;
	return entry.d == null ? entry.k === "MOVIE" : entry.d >= FEATURE_MINUTES;
};

// AniList scores 0-100, AOD 1-10. Everything downstream was written against
// the AniList scale.
const scoreOf = (entry) =>
	entry?.c == null ? null : Math.round(entry.c * 10);

// --- the live exception path ------------------------------------------------
// The index is a weekly snapshot, so anything still airing has a stale episode
// count and status. One batched call patches those, and nothing else.

const LIVE = `query Live($ids: [Int]) {
	Page(perPage: 50) {
		media(id_in: $ids, type: ANIME) {
			id episodes status
			title { english romaji }
			coverImage { extraLarge color }
		}
	}
}`;

async function fetchLive(ids) {
	const live = new Map();
	for (let i = 0; i < ids.length; i += 50) {
		const data = await anilistQuery(LIVE, { ids: ids.slice(i, i + 50) });
		for (const media of data?.Page?.media ?? []) live.set(media.id, media);
	}
	return live;
}

const RESOLVE = `query Resolve($search: String!, $year: Int) {
	Page(perPage: 1) {
		media(type: ANIME, search: $search, seasonYear: $year, sort: SEARCH_MATCH) {
			id
			title { romaji english native }
			coverImage { extraLarge color }
		}
	}
}`;

// Only for shows the tmdb mapping has never heard of -- about one in twenty,
// and skewed towards donghua, adult titles and releases from the last month.
// There is no season data to be had, so this claims the row as anime and
// upgrades the artwork, leaving tmdb's own seasons in place.
async function resolveUnmapped({ nativeTitle, fallbackTitle, year, tmdbSeasons }) {
	for (const [search, seasonYear] of [
		[nativeTitle, year],
		[nativeTitle, null],
		[fallbackTitle, year],
	]) {
		if (!search) continue;
		const data = await anilistQuery(RESOLVE, { search, year: seasonYear });
		const media = data?.Page?.media?.[0];
		if (!media) continue;

		const titles = [
			media.title?.romaji,
			media.title?.english,
			media.title?.native,
		];
		if (!titleMatches(search, titles)) continue;

		const cover = media.coverImage?.extraLarge ?? null;
		return {
			anilistId: media.id,
			titleRomaji: media.title?.romaji ?? null,
			slots: (tmdbSeasons ?? []).map((season, index) => ({
				uid: null,
				anilistId: media.id,
				season_number: season.season_number,
				episode_count: season.episode_count,
				label: null,
				number: String(season.season_number),
				episodes: season.episode_count,
				startDate: null,
				posterUrl: season.posterUrl ?? (index === 0 ? cover : null),
				posterColor: media.coverImage?.color ?? null,
			})),
			films: [],
			sideStories: [],
		};
	}
	return null;
}

// --- numbering --------------------------------------------------------------

// "Shingeki no Kyojin Season 3 Part 2" -> "3.2", "Sousou no Frieren 2nd Season" -> "2"
function numberFromTitle(title) {
	if (!title) return null;
	const season =
		title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i) ??
		title.match(/\bseason\s+(\d+)\b/i);
	if (!season) return null;
	const part = title.match(/\bpart\s+(\d+)\b/i);
	return part ? `${season[1]}.${part[1]}` : season[1];
}

// The tmdb season a row maps to is authoritative, so numbering is a walk down
// the chain rather than the episode-count zip the previous pass had to guess
// with. A new number starts when the tmdb season changes or the title declares
// one; anything else continues the season it follows as the next part.
function applyNumbers(slots) {
	let base = 0;
	let part = 0;
	let prevSeason = null;

	for (const slot of slots) {
		const declared = numberFromTitle(slot.label);
		const declaredBase = declared ? Number(declared.split(".")[0]) : null;

		if (declaredBase != null && declaredBase !== base) {
			base = declaredBase;
			part = 1;
		} else if (prevSeason === null || slot.tmdbSeason !== prevSeason) {
			base = declaredBase ?? base + 1;
			part = 1;
		} else {
			// Continuing the current run. This is the case that carries an
			// untitled cour: Frieren's newest is filed under tmdb season 1
			// with nothing but an offset to say it follows the second season.
			part += 1;
		}

		prevSeason = slot.tmdbSeason;
		slot.number = `${base}.${part}`;
	}

	// "3.1" with no sibling "3.2" is just "3"
	const counts = new Map();
	for (const slot of slots) {
		const key = slot.number.split(".")[0];
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	for (const slot of slots) {
		const key = slot.number.split(".")[0];
		if (counts.get(key) === 1) slot.number = key;
	}
}

// --- assembly ---------------------------------------------------------------

export async function buildAnimeChain({
	tmdbId,
	nativeTitle,
	fallbackTitle,
	year,
	tmdbSeasons,
}) {
	const rows = tmdbRows(tmdbId);
	if (!rows.length) {
		return resolveUnmapped({ nativeTitle, fallbackTitle, year, tmdbSeasons });
	}

	// Season 0 is where the mapping files ovas, specials and tie-in films.
	// A MOVIE-typed row is a film wherever it happens to be filed.
	const typeOf = (row) => aodEntry(row.i)?.k ?? row.k;
	const episodicRows = rows.filter(
		(row) => (row.s ?? 1) > 0 && typeOf(row) !== "MOVIE",
	);
	const extraRows = rows.filter((row) => !episodicRows.includes(row));
	if (!episodicRows.length) {
		return resolveUnmapped({ nativeTitle, fallbackTitle, year, tmdbSeasons });
	}

	// The snapshot is authoritative for finished series and wrong for airing
	// ones, so only the airing ids -- plus anything the snapshot missed -- cost
	// a request. A fully finished show resolves without touching the network.
	// Only AniList-backed entries can be refreshed -- a "d" row has no AniList
	// record to ask about, and lives on whatever the snapshot last knew.
	const stale = [];
	for (const row of rows) {
		const id = anilistIdOf(row.i);
		if (id == null) continue;
		const entry = aodEntry(row.i);
		if (!entry || entry.s === "ONGOING" || entry.s === "UPCOMING") {
			stale.push(id);
		}
	}
	let live = new Map();
	if (stale.length) {
		try {
			live = await fetchLive(stale);
		} catch (error) {
			// the snapshot is still a usable answer, just an older one
			console.error("AniList refresh failed: ", error.message);
		}
	}

	// tmdb's own episode_count per season, to fill rows the mapping can name
	// but neither source can count -- always the newest cour.
	const tmdbCounts = new Map(
		(tmdbSeasons ?? []).map((s) => [s.season_number, s.episode_count]),
	);
	const tmdbPosters = new Map(
		(tmdbSeasons ?? []).map((s) => [s.season_number, s.posterUrl ?? null]),
	);

	const slots = episodicRows.map((row, index) => {
		const season = row.s ?? 1;
		const entry = aodEntry(row.i);
		const media = live.get(anilistIdOf(row.i));

		// A row with no offset starts at zero; the next row in the same season
		// starts where this one ends, which is what bounds its length.
		const next = episodicRows[index + 1];
		const offset = row.o ?? 0;
		const seasonTotal = tmdbCounts.get(season) ?? null;
		const span =
			next && (next.s ?? 1) === season && next.o != null
				? next.o - offset
				: seasonTotal != null
					? seasonTotal - offset
					: null;
		// a tmdb season that has not caught up with the mapping yet gives a
		// negative remainder, which is worse than admitting we do not know
		const derived = span != null && span > 0 ? span : null;

		const episodes = media?.episodes ?? entry?.e ?? derived ?? null;
		// Left null when neither source names the cour. Synthesising something
		// from the show title looks helpful and is not: the ui already falls
		// back to the show title, and a made-up "Season 2" in the label feeds
		// straight back into numberFromTitle and renumbers the chain.
		const label =
			media?.title?.english ?? media?.title?.romaji ?? entry?.t ?? null;

		// AniList art when it was fetched, otherwise the (upsized) picture the
		// snapshot carries. Both are textless key visuals; tmdb's season
		// poster carries its own title lockup and is the fallback.
		const textless = media?.coverImage?.extraLarge ?? entry?.p ?? null;
		const tmdbPoster = tmdbPosters.get(season) ?? null;

		return {
			// slots stay a superset of the tmdb season shape
			season_number: index + 1,
			episode_count: episodes ?? 0,
			tmdbSeason: season,
			// the index key, stable whether the entry came from AniList or
			// AniDB, and the identity everything downstream matches on
			uid: row.i ?? null,
			anilistId: anilistIdOf(row.i),
			label,
			number: null,
			episodes,
			startDate: startDateOf(entry),
			posterUrl: textless ?? tmdbPoster,
			// AOD ships no palette. Populated only on the airing path until the
			// poster mirror lands and can pull a swatch off the stored asset.
			posterColor: media?.coverImage?.color ?? null,
		};
	});

	// The mapping lists cours that have been announced and nothing more -- no
	// title, no date, and no episodes on tmdb either. There is nothing to
	// render and nothing to track, so they are dropped until they air.
	const known = slots.filter(
		(slot) => slot.episodes || slot.label || slot.startDate,
	);
	known.forEach((slot, index) => (slot.season_number = index + 1));

	applyNumbers(known);
	for (const slot of known) delete slot.tmdbSeason;

	// each extra records the slot it aired after, so the ui can file it at that
	// transition rather than park it in the middle of the episode chain
	const anchors = known
		.filter((slot) => slot.startDate)
		.map((slot) => ({
			afterSlot: slot.number,
			afterSlotAnilistId: slot.anilistId,
			date: slot.startDate,
		}))
		.sort((a, z) => a.date.localeCompare(z.date));

	const anchorFor = (date) => {
		if (!date) return { afterSlot: null, afterSlotAnilistId: null };
		let hit = null;
		for (const anchor of anchors) if (anchor.date <= date) hit = anchor;
		return {
			afterSlot: hit?.afterSlot ?? null,
			afterSlotAnilistId: hit?.afterSlotAnilistId ?? null,
		};
	};

	// Everything hanging off the chain: the mapping's season 0 rows, plus one
	// hop through the snapshot's relation graph. That hop is what surfaces
	// films tmdb never filed under the show -- Mugen Train is related to
	// Kimetsu season 1 and appears nowhere in its tmdb season list.
	const overrides = overridesFor(tmdbId);
	const slotKeys = new Set(known.map((slot) => slot.uid).filter(Boolean));
	const extras = new Map();
	for (const row of extraRows) {
		if (row.i && aodEntry(row.i)) extras.set(row.i, aodEntry(row.i));
	}
	for (const key of slotKeys) {
		for (const related of relatedKeys(key)) {
			if (slotKeys.has(related) || extras.has(related)) continue;
			const entry = aodEntry(related);
			// Discovery sticks to releases at least one of the big two
			// trackers recognises. AniDB splits material the others treat as
			// one release, so admitting every "d" key through relations lists
			// Attack on Titan's ovas twice and turns Demon Slayer's recap
			// screenings into six films. A "d" entry MyAnimeList also carries
			// is a real release AniList simply never indexed -- Attack on
			// Titan's own finale film is one. Rows tmdb maps to the show
			// directly are honoured either way.
			if (related[0] !== "a" && !entry?.m) continue;
			// TV entries reachable this way are spin-off series with tmdb shows
			// of their own, not extras belonging to this one
			if (entry && entry.k !== "TV") extras.set(related, entry);
		}
	}
	for (const key of overrides.exclude) extras.delete(key);

	const shape = (key, entry) => ({
		uid: key,
		anilistId: anilistIdOf(key),
		label: entry.t,
		format: entry.k,
		episodes: entry.e ?? null,
		duration: entry.d ?? null,
		startDate: startDateOf(entry),
		averageScore: scoreOf(entry),
		posterUrl: entry.p ?? null,
		posterColor: null,
		...anchorFor(startDateOf(entry)),
	});

	const films = [];
	const sideStories = [];
	for (const [key, entry] of extras) {
		// AOD tags compilations outright, which is what makes recap detection
		// possible without AniList's typed relation edges. A recap is still
		// worth listing, just not as a film you are told to go and watch.
		const film = overrides.films.has(key)
			? true
			: overrides.sides.has(key)
				? false
				: isFeature(entry) && !entry.x;
		if (film) {
			films.push({
				...shape(key, entry),
				// the film's own tmdb id, so opening it hands straight over to
				// the movie pipeline instead of re-resolving by title
				tmdbMovieId: entry.mv ?? null,
			});
		} else {
			sideStories.push(shape(key, entry));
		}
	}
	films.sort((a, z) => (a.startDate ?? "9999").localeCompare(z.startDate ?? "9999"));
	sideStories.sort(
		(a, z) => chronoKey(aodEntry(a.uid)) - chronoKey(aodEntry(z.uid)),
	);

	const root = known[0];
	return {
		anilistId: root?.anilistId ?? null,
		titleRomaji: aodEntry(root?.uid)?.t ?? null,
		slots: known,
		films,
		sideStories,
	};
}
