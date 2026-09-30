import { positionsOf } from "../utils/utilFunctions.js";

const SIDE_WEIGHT = 0.25;
const DEFAULT_DURATION = 24;
const MIN_PHI = 40;

// weight is runtime, never part count
const runtimeOf = (part, fallback) =>
	(Number(part?.episode_count) || 0) * (Number(part?.duration) || fallback);

const isSidePart = (part) =>
	part?.kind === "sideStory" || (part?.kind === "film" && !part?.isMainLine);

function medianDuration(positions) {
	const known = positions
		.map((part) => Number(part?.duration))
		.filter((duration) => Number.isFinite(duration) && duration > 0)
		.sort((a, z) => a - z);
	if (!known.length) return DEFAULT_DURATION;
	const mid = known.length >> 1;
	return known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
}

export const hiddenIdsOf = (marks) =>
	[...marks.entries()]
		.filter(([, mark]) => mark?.hidden)
		.map(([anilistId]) => anilistId);

// the rollup and its inverse both need this
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

// glicko bounds
const MU_MIN = 200;
const MU_MAX = 2000;

export function pushDownDelta(seasons, marks, previous, next) {
	if (!previous || !next) return [];
	// a null row score is not zero
	if (previous.mu == null || previous.phi == null) return [];
	if (next.mu == null || next.phi == null) return [];
	const shift = next.mu - previous.mu;
	// leave confidence alone
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
		phi: Math.max(MIN_PHI, mark.phi * scale),
	}));
}
