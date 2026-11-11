# kozos-terv

Közös tervezőapp: több ember a saját Claude-előfizetésével tervez egy közös projekten, MCP-n
keresztül, úgy, hogy a Claude-ok nem írják felül egymás munkáját. Specifikáció: [`docs/SPEC.md`](docs/SPEC.md).

**Állapot:** 1. lépés kész (adatmodell, közös mag: zár, revízió, javaslat, eseménynapló, tesztekkel).

## Fejlesztés

```bash
npm install
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # Postgres + tesztadatbázis
npm run db:migrate                               # séma a DATABASE_URL-re
npm test                                         # tesztek a TEST_DATABASE_URL-en (minden futás újraépíti)
npm run check                                    # típusellenőrzés
npm run dev
```

## Felépítés

| Hely | Mi van benne |
|---|---|
| `src/lib/server/db/schema.ts` | Drizzle-séma (16 tábla) |
| `src/lib/server/core/` | Közös mag – minden írás itt dől el |
| `drizzle/` | Generált migrációk (`npm run db:generate`) |
| `tests/` | Vitest valódi Postgresen, párhuzamos írás tesztjeivel |

## A közös mag röviden

- **Revíziószám:** minden írás megadja, melyik revízióból dolgozik (`baseRevision`); ha közben
  változott, `STALE_REVISION` a friss tartalommal és a különbséggel.
- **Szakaszzár:** `lockSection` (20 perc, max. 120), lejár magától; más zárja alatt `SECTION_LOCKED`.
- **Védett dokumentum:** a Claude csak `proposeChange`-et tehet, ember fogad el (`acceptProposal`).
- **Eseménynapló:** minden írás eseményt ír; `getChangesSinceLastVisit` a „mi változott, mióta itt voltam”.
