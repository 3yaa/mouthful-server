export function parseTitleNumber(title) {
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

// "2" for a lone season, "2-1" once a season splits into parts
export function numberParts(mainline) {
	let season = 0;
	let part = 0;
	const numbers = mainline.map((anime, index) => {
		const parsed = parseTitleNumber(anime.title);
		if (index > 0 && parsed.continuesFinalSeason) {
			// final chapters follows part
			part += 1;
		} else if (
			index > 0 &&
			parsed.part > 1 &&
			(parsed.season === null || parsed.season === season)
		) {
			part = parsed.part;
		} else {
			season = parsed.season ?? season + 1;
			part = parsed.part ?? 1;
		}
		return [season, part];
	});

	const partsIn = new Map();
	for (const [season] of numbers) {
		partsIn.set(season, (partsIn.get(season) ?? 0) + 1);
	}
	mainline.forEach((anime, index) => {
		const [season, part] = numbers[index];
		anime.number =
			partsIn.get(season) > 1 ? `${season}-${part}` : String(season);
	});
}
