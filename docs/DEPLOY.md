# Teréz – telepítés az otthoni szerverre

Az app Docker Compose-zal fut: `app` (SvelteKit + MCP), `db` (Postgres) és `tunnel`
(Cloudflare Tunnel → `https://terv.nebulooo.com`). A weben Google-fiókkal lehet belépni,
a Claude-ok OAuth 2.1-gyel kapcsolódnak, mindenki a saját fiókjával.

## 0. Előfeltételek (egyszer)

**Google OAuth-kliens** (Google Cloud Console → Google Auth Platform):
- Audience: External, *Testing* mód; a *Test users* közé minden tag Gmail-címe.
- Client → Web application, *Authorized redirect URIs*:
  - `https://terv.nebulooo.com/api/auth/callback/google`
  - `http://localhost:3100/api/auth/callback/google` (helyi próbához)

**Cloudflare Tunnel** (Zero Trust → Networks → Tunnels):
- Published application: `terv.nebulooo.com` → `http://app:3000`, Access-szabály **nélkül**.
- A tunnel tokenje a `.env`-be kerül.

## 1. Letöltés és `.env`

```bash
git clone https://github.com/tubegamevideo-coder/kozos-terv.git   # vagy: git pull
cd kozos-terv
cp .env.example .env    # ha már van .env, a lenti kulcsokat vedd át belőle
```

```ini
POSTGRES_PASSWORD=<openssl rand -hex 16>
APP_BIND=127.0.0.1            # vagy a szerver Tailscale-címe
APP_PORT=3100

COMPOSE_PROFILES=public
ORIGIN=https://terv.nebulooo.com
CLOUDFLARE_TUNNEL_TOKEN=<a tunnel tokenje>

AUTH_MODE=oauth
GOOGLE_CLIENT_ID=<…apps.googleusercontent.com>
GOOGLE_CLIENT_SECRET=<…>

SEED_USERS=Levente=te@gmail.com,Kolléga=kollega@gmail.com
```

A `SEED_USERS` címei legyenek **pontosan azok a Gmail-címek**, amelyekkel beléptek: a belépés
e-mail-cím alapján köti össze a Google-fiókot a taggal. A `.env` nem kerül a gitbe.

## 2. Indítás

```bash
docker compose up -d --build
docker compose ps                                   # app: healthy, tunnel: running
curl https://terv.nebulooo.com/healthz              # → ok
docker compose exec app node --import tsx scripts/seed-dev.ts   # ismételten futtatható
```

Ha a seed korábban más e-mail-címekkel futott, a régi felhasználók megmaradnak; ilyenkor a
főoldalon (belépés után) a „Tagok meghívása” résznél hívd meg a helyes Gmail-címeket.

## 3. Belépés és meghívás

1. `https://terv.nebulooo.com` → „Belépés Google-fiókkal”.
2. Az első `SEED_USERS`-tag a „Fabak” munkatér tulajdonosa: a főoldalon további tagokat hívhat
   meg (Gmail-cím + szerepkör). A meghívott első belépéskor tag lesz. Amíg a Google-app
   *Testing* módban van, a címét a Google Cloud *Test users* listájára is fel kell venni.

## 4. Claude csatlakoztatása

**claude.ai / Claude asztali app:** Beállítások → Csatlakozók (Connectors) → *Egyedi csatlakozó
hozzáadása* → név: `Teréz`, URL: `https://terv.nebulooo.com/mcp`. A „Csatlakozás” gomb Google-belépést és egy
„Engedélyezem” oldalt nyit; utána a Claude a te nevedben dolgozik. A csatlakozó a mobilappban is
megjelenik.

**Claude Code:**
```bash
claude mcp add --scope user --transport http terez https://terv.nebulooo.com/mcp
# Claude Code-ban: /mcp → terez → Authenticate
```

A kapcsolódott klienseket a főoldalon látod, és bármikor visszavonhatod.

## Frissítés

```bash
git pull && docker compose up -d --build     # induláskor magától migrál
```

Figyelem: `.env`-módosítás után `docker compose up -d` kell (a `restart` nem olvassa újra).

## Mentés (amíg nincs automatikus)

```bash
docker compose exec -T db pg_dump -U postgres kozos_terv | gzip > kozos-terv-$(date +%F).sql.gz
```

## Hibakeresés

- `docker compose logs -f app tunnel`
- Cloudflare 502/1033: a `tunnel` konténer nem fut, vagy a cél nem `http://app:3000`.
- „redirect_uri_mismatch” a Google-nél: a callback-cím nincs felvéve a Google-kliensnél.
- „nincs meghívója”: a Gmail-cím nem egyezik a taghoz tartozó címmel → meghívás a főoldalon.
- Helyi próba tunnel nélkül: `COMPOSE_PROFILES=`, `ORIGIN=http://localhost:3100`, és
  `http://localhost:3100` a szerveren (a Google-belépés ehhez a localhost callback-címet használja).
