import { pool } from "../../config/db.js";

const convertMangaToCamelCase = (manga) => ({
	id: manga.id,
	title: manga.title,
	author: manga.author,
	cover: manga.cover ?? null,
	chapters: manga.chapters,
	curChapter: manga.cur_chapter,
	rating: manga.rating,
	datePublished: manga.date_published,
	series: manga.series ?? null,
	status: manga.status,
	score: manga.score_mu ? { mu: manga.score_mu, phi: manga.score_phi } : null,
	dateCompleted: manga.date_completed,
	note: manga.note,
	dateCreated: manga.date_created,
	lastUpdated: manga.last_updated,
	anilistId: manga.anilist_id,
	userId: manga.user_id,
});

export const getRandomManga = async (req, res) => {
	try {
		const userId = req.user.id;

		const result = await pool.query(
			`
      SELECT * FROM manga
      WHERE user_id=$1 AND status='Want to Read'
      ORDER BY RANDOM()
      LIMIT 10
      `,
			[userId],
		);

		const convertedManga = result.rows.map(convertMangaToCamelCase);

		res.json({
			success: true,
			data: convertedManga,
		});
	} catch (error) {
		console.error("Error fetching random manga: ", error);
		res.status(500).json({
			success: false,
			message: "Error fetching random manga",
			error: error.message,
		});
	}
};

export const getMangaList = async (req, res) => {
	try {
		const userId = req.user.id;
		const result = await pool.query(
			`
      SELECT * FROM manga
      WHERE user_id=$1
      ORDER BY
        CASE status
          WHEN 'Reading' THEN 1
          WHEN 'Want to Read' THEN 2
          WHEN 'Completed' THEN 3
          WHEN 'Dropped' THEN 4
          ELSE 5
        END,
        CASE
          WHEN status = 'Completed' THEN date_completed
          ELSE last_updated
        END DESC
      `,
			[userId],
		);

		const convertedManga = result.rows.map(convertMangaToCamelCase);

		res.json({
			success: true,
			count: convertedManga.length,
			data: convertedManga,
		});
	} catch (error) {
		console.error("Error fetching manga: ", error);
		res.status(500).json({
			success: false,
			message: "Error fetching manga",
			error: error.message,
		});
	}
};

export const getManga = async (req, res) => {
	try {
		const mangaId = req.params.id;
		const userId = req.user.id;
		const result = await pool.query(
			`SELECT * FROM manga WHERE id=$1 AND user_id=$2`,
			[mangaId, userId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({
				success: false,
				message: "Manga not found",
			});
		}

		const convertedManga = convertMangaToCamelCase(result.rows[0]);

		res.status(200).json({
			success: true,
			data: convertedManga,
		});
	} catch (error) {
		console.error("Error fetching manga: ", error);
		res.status(500).json({
			success: false,
			message: "Error fetching manga",
			error: error.message,
		});
	}
};

const COLUMNS = {
	title: "title",
	author: "author",
	cover: "cover",
	chapters: "chapters",
	curChapter: "cur_chapter",
	rating: "rating",
	datePublished: "date_published",
	series: "series",
	status: "status",
	score_mu: "score_mu",
	score_phi: "score_phi",
	dateCompleted: "date_completed",
	lastUpdated: "last_updated",
	note: "note",
	anilistId: "anilist_id",
};

export const patchManga = async (req, res) => {
	try {
		const mangaId = req.params.id;
		const userId = req.user.id;
		const { indirectUpdate, ...cleanUpdates } = req.body;
		const updates = { ...cleanUpdates };

		if (!indirectUpdate) {
			updates.lastUpdated = new Date();
		}

		if (updates.score !== undefined) {
			if (updates.score === null) {
				updates.score_mu = null;
				updates.score_phi = null;
			} else {
				updates.score_mu = updates.score.mu;
				updates.score_phi = updates.score.phi;
			}
			delete updates.score;
		}

		const keys = Object.keys(updates).filter((key) => COLUMNS[key]);
		if (!keys.length) {
			return res.status(400).json({
				success: false,
				message: "No updatable fields provided",
			});
		}

		// a typed chapter can't run past a known last one
		const setClause = keys
			.map((key, index) =>
				key === "curChapter"
					? `cur_chapter=LEAST($${index + 1}::int, COALESCE(chapters, $${index + 1}::int))`
					: `${COLUMNS[key]}=$${index + 1}`,
			)
			.join(", ");
		// a serial that just ended can't leave the reader past its last chapter
		const endAt = keys.indexOf("chapters");
		const endClamp =
			endAt !== -1 &&
			updates.chapters != null &&
			!keys.includes("curChapter")
				? `, cur_chapter=LEAST(cur_chapter, $${endAt + 1}::int)`
				: "";
		const values = keys.map((key) => updates[key]);
		values.push(mangaId);
		values.push(userId);

		const query = `
	 	UPDATE manga
		SET ${setClause}${endClamp} WHERE id=$${values.length - 1} AND user_id=$${
			values.length
		} RETURNING *
	  `;
		const result = await pool.query(query, values);

		if (result.rows.length === 0) {
			return res.status(404).json({
				success: false,
				message: "Manga not found",
			});
		}

		const convertedManga = convertMangaToCamelCase(result.rows[0]);

		res.status(200).json({
			success: true,
			message: "Manga updated successfully",
			data: convertedManga,
		});
	} catch (error) {
		console.error("Error updating manga: ", error);
		res.status(500).json({
			success: false,
			message: "Error updating manga",
			error: error.message,
		});
	}
};

export const createManga = async (req, res) => {
	try {
		const userId = req.user.id;
		const {
			title,
			author,
			cover: coverObj,
			datePublished,
			chapters,
			curChapter,
			rating,
			series,
			status,
			score: scoreObj,
			dateCompleted,
			note,
			anilistId,
		} = req.body;

		const query = `
    INSERT INTO manga (
      title,
      author,
      cover,
      date_published,
      chapters,
      cur_chapter,
      rating,
      series,
      status,
      score_mu,
      score_phi,
      date_completed,
      note,
      anilist_id,
      user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
    ) RETURNING *
	`;
		const values = [
			title,
			author,
			coverObj,
			datePublished,
			chapters ?? null,
			curChapter ?? 0,
			rating,
			series ?? null,
			status,
			scoreObj?.mu,
			scoreObj?.phi,
			dateCompleted,
			note,
			anilistId,
			userId,
		];
		const result = await pool.query(query, values);

		const convertedManga = convertMangaToCamelCase(result.rows[0]);

		res.status(201).json({
			success: true,
			message: "Manga Created Successfully",
			data: convertedManga,
		});
	} catch (error) {
		console.error("Error creating manga: ", error);
		res.status(500).json({
			success: false,
			message: "Error creating manga",
			error: error.message,
		});
	}
};

export const deleteManga = async (req, res) => {
	try {
		const mangaId = req.params.id;
		const userId = req.user.id;

		const result = await pool.query(
			"DELETE FROM manga WHERE id=$1 AND user_id=$2 RETURNING *",
			[mangaId, userId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({
				success: false,
				message: "Manga not found",
			});
		}

		const convertedManga = convertMangaToCamelCase(result.rows[0]);

		res.status(200).json({
			success: true,
			message: "Manga deleted successfully",
			data: convertedManga,
		});
	} catch (error) {
		console.error("Error deleting manga: ", error);

		res.status(500).json({
			success: false,
			message: "Error deleting manga",
			error: error.message,
		});
	}
};
