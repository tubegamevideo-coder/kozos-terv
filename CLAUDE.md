# kozos-terv – szabályok Claude-nak

A specifikáció: `docs/SPEC.md`. Ha valamit nyitva hagy, kérdezz, ne találgass.

## Felépítés

- `src/lib/server/db/` – Drizzle-séma és kapcsolat. Séma módosítása után: `npm run db:generate`.
- `src/lib/server/core/` – **a közös mag**. Minden írás (szakasz, zár, javaslat, kérdés, ötlet,
  megjegyzés, esemény) csak innen mehet. Az MCP-réteg és a felület ezt hívja, sosem az
  adatbázist közvetlenül.
- `src/lib/server/mcp/` – MCP-eszközök (2. lépéstől).
- `src/routes/` – SvelteKit-oldalak és végpontok.
- `tests/` – Vitest, valódi Postgresen (`TEST_DATABASE_URL`).

## Szabályok

- Minden szakaszírás egy tranzakció: `SELECT … FOR UPDATE` a szakasz során, utána ellenőrzés
  (lomtár, jogosultság, védettség, zár, `baseRevision`), majd új revízió + esemény.
- Hibát `CoreError`-ral dobunk, stabil `code`-dal (`STALE_REVISION`, `SECTION_LOCKED`,
  `PROTECTED_DOCUMENT`, `FORBIDDEN`, `NOT_FOUND`, `EDIT_NO_MATCH`, `EDIT_AMBIGUOUS`, …) és
  a Claude-nak hasznos `details`-szel (friss tartalom, diff, zártartó).
- Semmit nem törlünk ténylegesen: `deletedAt` (lomtár). A revíziók nem módosíthatók.
- Minden revízión és eseményen `actorKind`: `human` vagy `claude`.
- Azonosítók: szöveges UUID (`crypto.randomUUID()`), időbélyegek `timestamptz`.
- A felület és a hibaüzenetek magyarul; a kód, az azonosítók és a commitok angolul.
- Új logika mellé teszt kell. Commit előtt: `npm run check && npm test`.

## Parancsok

- `npm run dev` – fejlesztői szerver
- `npm test` – tesztek (helyi Postgres kell, lásd `README.md`)
- `npm run check` – típusellenőrzés
- `npm run db:generate` / `npm run db:migrate` – migrációk
