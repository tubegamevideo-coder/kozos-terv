# kozos-terv

Közös tervezőapp: több ember a saját Claude-előfizetésével tervez egy közös projekten, MCP-n
keresztül, úgy, hogy a Claude-ok nem írják felül egymás munkáját. Specifikáció: [`docs/SPEC.md`](docs/SPEC.md).

**Állapot:** 3. lépés kész – Google-belépés, saját OAuth 2.1 szerver a Claude-oknak (DCR, PKCE),
nyilvános cím Cloudflare Tunnelen; MCP-szerver 24 eszközzel és 3 prompttal.
Telepítés az otthoni szerverre: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Fejlesztés

```bash
npm install
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # Postgres + tesztadatbázis
npm run db:migrate                               # séma a DATABASE_URL-re
SEED_USERS="Levente=a@b.hu" npm run seed:dev     # kezdőadatok
npm test                                         # tesztek a TEST_DATABASE_URL-en (minden futás újraépíti)
npm run check                                    # típusellenőrzés
npm run dev
```

## Felépítés

| Hely | Mi van benne |
|---|---|
| `src/lib/server/db/schema.ts` | Drizzle-séma (16 tábla) |
| `src/lib/server/core/` | Közös mag – minden írás itt dől el |
| `src/lib/server/mcp/` | MCP-eszközök, promptok, a `/mcp` kezelője |
| `src/routes/mcp/+server.ts` | A `/mcp` végpont (Streamable HTTP, állapotmentes) |
| `src/lib/server/auth/` | Google-belépés, munkamenetek, OAuth 2.1 szerver (`oauth.ts`) |
| `scripts/seed-dev.ts` | Fejlesztői kezdőadatok, a SPEC importjával |
| `drizzle/` | Generált migrációk (`npm run db:generate`) |
| `tests/` | Vitest valódi Postgresen, párhuzamos írás tesztjeivel |

## A közös mag röviden

- **Revíziószám:** minden írás megadja, melyik revízióból dolgozik (`baseRevision`); ha közben
  változott, `STALE_REVISION` a friss tartalommal és a különbséggel.
- **Szakaszzár:** `lockSection` (20 perc, max. 120), lejár magától; más zárja alatt `SECTION_LOCKED`.
- **Védett dokumentum:** a Claude csak `proposeChange`-et tehet, ember fogad el (`acceptProposal`).
- **Eseménynapló:** minden írás eseményt ír; `getChangesSinceLastVisit` a „mi változott, mióta itt voltam”.
