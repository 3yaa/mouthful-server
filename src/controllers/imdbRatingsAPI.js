import { createGunzip } from "zlib";
import { Readable } from "stream";

let cache = null;
const TTL = 24 * 60 * 60 * 1000;

async function loadRatings() {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;

  const res = await fetch("https://datasets.imdbws.com/title.ratings.tsv.gz");
  const buffer = Buffer.from(await res.arrayBuffer());

  const decompressed = await new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks = [];
    Readable.from(buffer).pipe(gunzip);
    gunzip.on("data", (c) => chunks.push(c));
    gunzip.on("end", () => resolve(Buffer.concat(chunks)));
    gunzip.on("error", reject);
  });

  const map = new Map();
  const lines = decompressed.toString("utf-8").split("\n");
  for (let i = 1; i < lines.length; i++) {
    const [tconst, avg, votes] = lines[i].split("\t");
    if (tconst)
      map.set(tconst, { rating: parseFloat(avg), votes: parseInt(votes) });
  }

  cache = { data: map, ts: Date.now() };
  return map;
}

export async function getImdbRatings(ids) {
  const ratings = await loadRatings();
  const result = {};
  for (const id of ids) {
    const entry = ratings.get(id);
    if (entry) result[id] = entry;
  }
  return result;
}
