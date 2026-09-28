import dotenv from "dotenv";
import { resetToken, getAccessToken } from "./twitchAccessToken.js";
import { httpFetch } from "../../utils/httpFetch.js";

dotenv.config();

async function makeIgdbRequest(query, accessToken, endpoint) {
	const url = `https://api.igdb.com/v4/${endpoint}`;

	return await httpFetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Client-ID": process.env.TWITCH_CLIENT_ID,
			Accept: "application/json",
		},
		body: query,
	});
}

export async function makeIgdbRequestWithRety(query, endpoint = "games") {
	try {
		// first attempt
		const accessToken = await getAccessToken();
		let response = await makeIgdbRequest(query, accessToken, endpoint);
		// second attempt
		if (response.status === 401) {
			resetToken();
			const newToken = await getAccessToken();
			response = await makeIgdbRequest(query, newToken, endpoint);
		}
		//
		return response;
	} catch (error) {
		console.error("IGDB API request failed:", error);
		throw error;
	}
}
