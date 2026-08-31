import { rollupOf, pushDownDelta } from "./nodesRollup.js";

// attaches every mark on a row as one jsonb object -- callers alias shows as s
export const PARTS_JOIN = `
	LEFT JOIN LATERAL (
		SELECT jsonb_object_agg(ap.anilist_id::text, jsonb_build_object(
			'score', CASE WHEN ap.score_mu IS NULL THEN NULL
				ELSE jsonb_build_object('mu', ap.score_mu, 'phi', ap.score_phi) END,
			'note', ap.note,
			'hidden', ap.hidden
		)) AS parts
		FROM anime_nodes ap WHERE ap.show_id = s.id
	) p ON true`;

export async function loadMarks(client, showId) {
	const { rows } = await client.query(
		`SELECT anilist_id, score_mu, score_phi, note, hidden FROM anime_nodes WHERE show_id=$1`,
		[showId],
	);
	const marks = new Map();
	for (const row of rows) {
		marks.set(Number(row.anilist_id), {
			mu: row.score_mu,
			phi: row.score_phi,
			note: row.note,
			hidden: row.hidden,
		});
	}
	return marks;
}

// a mark saying nothing is not a mark -- keeps the table sparse
const isEmpty = (mark) => mark.mu == null && !mark.note && !mark.hidden;

export async function writeMark(client, showId, anilistId, mark) {
	if (isEmpty(mark)) {
		await client.query(
			`DELETE FROM anime_nodes WHERE show_id=$1 AND anilist_id=$2`,
			[showId, anilistId],
		);
		return;
	}
	await client.query(
		`INSERT INTO anime_nodes (show_id, anilist_id, score_mu, score_phi, note, hidden)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (show_id, anilist_id) DO UPDATE SET
			score_mu=EXCLUDED.score_mu, score_phi=EXCLUDED.score_phi,
			note=EXCLUDED.note, hidden=EXCLUDED.hidden`,
		[showId, anilistId, mark.mu, mark.phi, mark.note, mark.hidden],
	);
}

// the row score IS the rollup once any part is scored -- with none, the row keeps whatever it already had
export async function applyRollup(client, showId, seasons, marks) {
	const rolled = rollupOf(seasons, marks);
	if (!rolled) return null;
	await client.query(
		`UPDATE shows SET score_mu=$1, score_phi=$2 WHERE id=$3`,
		[rolled.mu, rolled.phi, showId],
	);
	return rolled;
}

// keeps row score == rollup(parts) when a battle wrote the row directly
export async function pushRowScoreDown(
	client,
	showId,
	seasons,
	marks,
	previous,
	next,
) {
	const rows = pushDownDelta(seasons, marks, previous, next);
	for (const row of rows) {
		await client.query(
			`UPDATE anime_nodes SET score_mu=$1, score_phi=$2 WHERE show_id=$3 AND anilist_id=$4`,
			[row.mu, row.phi, showId, row.anilistId],
		);
	}
	return rows.length;
}
