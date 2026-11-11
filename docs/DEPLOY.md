# Telepítés az otthoni szerverre

Ez a leírás a **2. lépéshez** szól: az app és az MCP-szerver fut az otthoni szerveren, de csak
helyben (vagy a Tailscale-hálón) érhető el, fejlesztői tokenekkel. Nyilvános címet
(`terv.nebulooo.com`) csak a 3. lépésben kap, a Google-belépéssel és az OAuth-tal együtt –
belépés nélkül az MCP-szervert nem szabad kitenni az internetre.

Kell hozzá: Docker Compose és git a szerveren.

## 1. Letöltés és beállítás

```bash
git clone https://github.com/tubegamevideo-coder/kozos-terv.git
cd kozos-terv
cp .env.example .env
```

Tokenek generálása (felhasználónként egy):

```bash
openssl rand -hex 24   # a te tokened
openssl rand -hex 24   # a kollégádé
```

A `.env`-ben töltsd ki:

```ini
POSTGRES_PASSWORD=<hosszú véletlen jelszó: openssl rand -hex 16>
APP_BIND=127.0.0.1          # vagy a szerver Tailscale-címe, ha a laptopodról is el akarod érni
APP_PORT=3100
AUTH_MODE=dev
MCP_DEV_TOKENS=<te tokened>=te@email.hu,<kolléga tokenje>=kollega@email.hu
SEED_USERS=Levente=te@email.hu,Kolléga=kollega@email.hu
```

Az e-mail-címek a 3. lépésben a Google-belépéshez kötődnek majd, ezért a valódi Gmail-címeket
érdemes megadni. A `.env` nem kerül a gitbe.

## 2. Indítás

```bash
docker compose up -d --build
curl http://127.0.0.1:3100/healthz        # → ok
docker compose exec app node --import tsx scripts/seed-dev.ts
```

A seed létrehozza a felhasználókat, a „Fabak” munkateret, a „Közös tervezőapp” projektet (benne
a specifikáció védett fő tervként) és az üres „Pályázatfigyelő” projektet. Ismételten futtatható.

## 3. Claude Code csatlakoztatása

A szerveren (vagy Tailscale-en át a laptopodon, ha `APP_BIND` a Tailscale-cím):

```bash
claude mcp add --scope user --transport http kozos-terv http://127.0.0.1:3100/mcp \
  --header "Authorization: Bearer <a te tokened>"
claude mcp list        # → kozos-terv: … ✓ Connected
```

Kipróbálás Claude Code-ban: `/mcp__kozos-terv__mi_tortent`, vagy egyszerűen: „Nézd meg a
közös tervezőappban a Pályázatfigyelő projektet.”

Ha a kolléga is a tailneten van, ő a saját tokenjével ugyanígy csatlakozik. Ha nincs, neki a
3. lépésig (nyilvános cím + Google-belépés) várnia kell.

## 4. MCP Inspector (opcionális)

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3100/mcp --transport http \
  --header "Authorization: Bearer <token>" --method tools/list
```

## Frissítés

```bash
git pull && docker compose up -d --build     # induláskor magától migrál
```

## Mentés (amíg nincs automatikus)

```bash
docker compose exec -T db pg_dump -U postgres kozos_terv | gzip > kozos-terv-$(date +%F).sql.gz
```

Az automatikus napi mentés a NAS-ra az éles indulás előtt kerül be.
