// Hand corrections, keyed by tmdb tv id.
//
// The mapping and the relation graph are right almost all of the time. This is
// where the rest goes, rather than into another heuristic that trades one set
// of wrong answers for a different one.
//
//   exclude  index keys that should not appear anywhere in the chain --
//            crossovers the relation graph drags in, duplicate entries
//   films    keys the feature test files as side stories but that are films
//   sides    keys the feature test calls films but that are shorts or recaps
//
// Keys are "a<anilist id>" or "d<anidb id>", the same addresses the index uses.
//
// Anything listed here is applied after assembly, so an id that stops being
// wrong upstream can simply be deleted from the list.

export const CHAIN_OVERRIDES = {
	// Isekai Quartet is a crossover with its own tmdb show; the relation graph
	// reaches it from every series that appears in it.
	65942: { exclude: ["a117074", "a104454", "a110178", "a194447"] },
};

export function overridesFor(tmdbId) {
	const entry = CHAIN_OVERRIDES[Number(tmdbId)] ?? {};
	return {
		exclude: new Set(entry.exclude ?? []),
		films: new Set(entry.films ?? []),
		sides: new Set(entry.sides ?? []),
	};
}
