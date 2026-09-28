export const validateSteamLink = (req, res, next) => {
	const { profile } = req.body ?? {};
	if (typeof profile !== "string" || !profile.trim() || profile.length > 200) {
		return res.status(400).json({
			success: false,
			message: "Invalid profile field provided (a Steam profile link or id)",
		});
	}
	next();
};
