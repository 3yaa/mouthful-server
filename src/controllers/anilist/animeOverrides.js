// Hand corrections, keyed by tmdb tv id.
//
// The mapping and the relation graph are right almost all of the time. This is
// where the rest goes, rather than into another heuristic that trades one set
// of wrong answers for a different one.
//
//   exclude  anilist ids that should not appear anywhere in the chain --
//            crossovers the relation graph drags in, duplicate entries
//   films    ids the feature test files as side stories but that are films
//   sides    ids the feature test calls films but that are shorts or recaps
//
// Anything listed here is applied after assembly, so an id that stops being
// wrong upstream can simply be deleted from the list.

export const CHAIN_OVERRIDES = {
	// Isekai Quartet is a crossover with its own tmdb show; the relation graph
	// reaches it from every series that appears in it.
	65942: { exclude: [117074, 104454, 110178, 194447] },
};

export function overridesFor(tmdbId) {
	const entry = CHAIN_OVERRIDES[Number(tmdbId)] ?? {};
	return {
		exclude: new Set(entry.exclude ?? []),
		films: new Set(entry.films ?? []),
		sides: new Set(entry.sides ?? []),
	};
}
