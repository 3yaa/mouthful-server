function parseTitleNumber(title) {
	if (!title) {
		return {
			season: null,
			part: null,
			continuesFinalSeason: false,
		};
	}
	//
	const seasonMatch =
		title.match(/\bseason\s+(\d+)\b/i) ??
		title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
	//
	const partMatch =
		title.match(/\bpart\s+(\d+)\b/i) ??
		title.match(/\bcour\s+(\d+)\b/i) ??
		title.match(/\b(\d+)(?:st|nd|rd|th)\s+cour\b/i);

	return {
		season: seasonMatch ? Number(seasonMatch[1]) : null,
		part: partMatch ? Number(partMatch[1]) : null,

		// AOT's Final Chapters continue Final Season even tho no part
		continuesFinalSeason: /\bfinal chapters?\b/i.test(title),
	};
}

export function applyPartsForSeason(mainline, compareStartDate) {
	let currentSeason = 0;
	let currentPart = 0;

	// 1st: determine anime's logical season and part
	for (let index = 0; index < mainline.length; index++) {
		const anime = mainline[index];
		anime.position = index + 1; // unique traversal number

		const parsed = parseTitleNumber(anime.title);
		const continuesPart =
			index > 0 &&
			parsed.part !== null &&
			parsed.part > 1 &&
			(parsed.season === null || parsed.season === currentSeason);

		if (parsed.continuesFinalSeason && index > 0) {
			// final chapters follows part.
			currentPart += 1;
		} else if (continuesPart) {
			currentPart = parsed.part;
		} else {
			// new season
			currentSeason = parsed.season ?? currentSeason + 1;
			currentPart = parsed.part ?? 1;
		}

		anime.seasonNo = currentSeason;
		anime.partNo = currentPart;
	}

	const seasonSizes = new Map();
	for (const anime of mainline) {
		// 2nd: count parts
		seasonSizes.set(
			anime.seasonNo,
			(seasonSizes.get(anime.seasonNo) ?? 0) + 1,
		);
	}

	// 3rd: create display number
	for (const anime of mainline) {
		const hasMultParts = seasonSizes.get(anime.seasonNo) > 1;
		//
		anime.number = hasMultParts
			? `${anime.seasonNo}-${anime.partNo}`
			: String(anime.seasonNo);
		//
		delete anime.seasonNo;
		delete anime.partNo;

		// Sort child records after all additional nodes have been attached.
		anime.subNodes.sort(compareStartDate);
		anime.variants.sort(compareStartDate);
	}
}
