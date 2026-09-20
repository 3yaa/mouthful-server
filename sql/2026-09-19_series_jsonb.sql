-- Series continuity moves from four flat columns to one jsonb column.
--
-- The flat columns stored a neighbour's *title* and nothing else, so every
-- jump had to be resolved by fuzzy name matching, and a placeholder title
-- ("Untitled F1 Sequel") resolved to nothing at all. `series` carries each
-- neighbour's source id alongside its title, so a jump is an id lookup.
--
-- Shape:
--   { "title": "Dune", "position": "2", "total": 3,
--     "prequel": { "id": "438631",  "title": "Dune" },
--     "sequel":  { "id": "1156593", "title": "Dune: Part Three" } }
--
-- `id` is whatever the source keys that medium by: a tmdb id for films, a
-- hardcover book id for books -- the same value the neighbour's own row holds
-- in its tmdb_id / key column, which is how a jump resolves to it.
--
-- No backfill: existing rows lose their series data and pick it back up the
-- next time they are refreshed from source.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.movies
	DROP COLUMN IF EXISTS series_title,
	DROP COLUMN IF EXISTS place_in_series,
	DROP COLUMN IF EXISTS prequel,
	DROP COLUMN IF EXISTS sequel,
	ADD COLUMN IF NOT EXISTS series jsonb;

ALTER TABLE public.books
	DROP COLUMN IF EXISTS series_title,
	DROP COLUMN IF EXISTS place_in_series,
	DROP COLUMN IF EXISTS prequel,
	DROP COLUMN IF EXISTS sequel,
	ADD COLUMN IF NOT EXISTS series jsonb;

COMMIT;

-- Outside the transaction above, so a wrong role name cannot roll the schema
-- change back. A table-level grant already covers new columns and this is then
-- a no-op; a column-level one does not, and without this the app role can read
-- every column except the new one, which surfaces as a 500 rather than as a
-- permissions error. Adjust the role if it is not mouthfuluser.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.movies TO mouthfuluser;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.books TO mouthfuluser;
