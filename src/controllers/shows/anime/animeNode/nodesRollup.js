import { positionsOf } from "../utils/utilFunctions.js";

const SIDE_WEIGHT = 0.25;
const DEFAULT_DURATION = 24;
const MIN_PHI = 40;

// weight is runtime, never part count -- six shorts dont outvote a season
const runtimeOf = (part, fallback) =>
	(Number(part?.episode_count) || 0) * (Number(part?.duration) || fallback);

const isSidePart = (part) =>
	part?.kind === "sideStory" || part?.isSide === true;

// the show's own typical episode length -- a blank duration not weigh 24x less than its neighbours
function medianDuration(positions) {
	const known = positions
		.map((part) => Number(part?.duration))
		.filter((duration) => Number.isFinite(duration) && duration > 0)
		.sort((a, z) => a - z);
	if (!known.length) return DEFAULT_DURATION;
	const mid = known.length >> 1;
	return known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
}

// the ids the user hid, in the shape positionsOf wants
export const hiddenIdsOf = (marks) =>
	[...marks.entries()]
		.filter(([, mark]) => mark?.hidden)
		.map(([anilistId]) => anilistId);

// the scored parts and the weight each carries -- the rollup and its inverse both need this
function weighted(seasons, marks) {
	// hidden parts not part of the show
	const positions = positionsOf(seasons, hiddenIdsOf(marks));
	const fallback = medianDuration(positions);
	const scored = [];
	for (const part of positions) {
		const mark = marks.get(Number(part?.anilistId));
		if (mark?.mu == null || mark?.phi == null) continue;
		const weight =
			runtimeOf(part, fallback) * (isSidePart(part) ? SIDE_WEIGHT : 1);
		// no episodes and no duration
		scored.push({
			anilistId: Number(part.anilistId),
			mark,
			w: weight > 0 ? weight : fallback,
		});
	}
	return { total: positions.length, scored };
}

// phi is pooled, not averaged: independent estimates combine to MORE confidence
export function rollupOf(seasons, marks) {
	const { total, scored } = weighted(seasons, marks);
	if (!total || !scored.length) return null;

	let sumW = 0;
	let sumWMu = 0;
	let sumW2Phi2 = 0;
	for (const { mark, w } of scored) {
		sumW += w;
		sumWMu += w * mark.mu;
		sumW2Phi2 += w * w * mark.phi * mark.phi;
	}
	if (sumW <= 0) return null;
	return {
		mu: sumWMu / sumW,
		phi: Math.max(MIN_PHI, Math.sqrt(sumW2Phi2) / sumW),
		scored: scored.length,
		total,
	};
}

// glicko's own bounds -- a shifted part must stay somewhere the scale can express
const MU_MIN = 200;
const MU_MAX = 2000;

// A battle moves the item, and the item IS the weighted mean of its parts, so the move has to come
// back down the way it went up. Inverting a mean is underdetermined, so the share each part takes
// is w*phi^2: how much it drove the score, times how unsure you were of it. A part battled to a
// tight number barely moves; the one you guessed at absorbs the correction. Uniform is the special
// case where every part is the same size and equally certain.
export function pushDownDelta(seasons, marks, previous, next) {
	if (!previous || !next) return [];
	// a null row score is not zero -- without this the shift is the whole score
	if (previous.mu == null || previous.phi == null) return [];
	if (next.mu == null || next.phi == null) return [];
	const shift = next.mu - previous.mu;
	// a zero previous phi has no scale to speak of -- leave confidence alone
	const scale = previous.phi > 0 ? next.phi / previous.phi : 1;
	if (shift === 0 && scale === 1) return [];

	const { scored } = weighted(seasons, marks);
	if (!scored.length) return [];
	let sumW = 0;
	// the same Σw²φ² the pooled phi is built from
	let denom = 0;
	for (const { mark, w } of scored) {
		sumW += w;
		denom += w * w * mark.phi * mark.phi;
	}

	return scored.map(({ anilistId, mark, w }) => ({
		anilistId,
		// share = d·Σw·wφ² / Σw²φ², which puts the weighted mean exactly on next.mu
		// no confidence anywhere to divide by leaves nothing to apportion on -- spread it evenly
		mu: Math.min(
			MU_MAX,
			Math.max(
				MU_MIN,
				mark.mu +
					(denom > 0
						? (shift * sumW * w * mark.phi * mark.phi) / denom
						: shift),
			),
		),
		// the same floor the item gets -- a node battled a dozen times over must not
		// end up claiming certainty the comparisons never earned
		phi: Math.max(MIN_PHI, mark.phi * scale),
	}));
}
