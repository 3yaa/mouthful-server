import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { createGunzip } from "zlib";
import { Readable } from "stream";
import { join } from "path";

export const TTL = 24 * 60 * 60 * 1000;

export async function fetchBuffer(url, file, force = false) {
	const DISK_CACHE = join("/tmp", file);
	if (
		!force &&
		existsSync(DISK_CACHE) &&
		Date.now() - statSync(DISK_CACHE).mtimeMs < TTL
	) {
		return readFileSync(DISK_CACHE);
	}
	// write to disk
	const res = await fetch(url);
	const buffer = Buffer.from(await res.arrayBuffer());
	writeFileSync(DISK_CACHE, buffer);
	return buffer;
}

export async function decompress(buffer) {
	return await new Promise((resolve, reject) => {
		const gunzip = createGunzip();
		const chunks = [];
		Readable.from(buffer).pipe(gunzip);
		gunzip.on("data", (c) => chunks.push(c));
		gunzip.on("end", () => resolve(Buffer.concat(chunks)));
		gunzip.on("error", reject);
	});
}
