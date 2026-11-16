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

## 5. Repóból hivatkozott szakaszok (nem kötelező)

Egy szakasz mutathat egy GitHub- vagy GitLab-fájlt is (például a rendszertervet egy app
`docs/` mappájából): itt csak olvasható, a repó változásai magától átjönnek (SPEC 11. fejezet).
Nyilvános repóhoz nem kell semmi. Privát repóhoz a legegyszerűbb az **SSH-kulcs** (deploy key),
ehhez a szerveren nem kell beállítani semmit:

1. A projekt **Beállítások → Repók** részén vedd fel a repót, majd **SSH-kulcs generálása**.
2. Másold ki a nyilvános kulcsot, és add hozzá a repóhoz: GitHubon *Settings → Deploy keys →
   Add deploy key*, GitLabon *Settings → Repository → Deploy keys*. Az írási jogot hagyd kikapcsolva.
3. Teréz-ben **Ellenőrzés**. Ha „rendben”, a repó fájljai hivatkozhatók.

A privát kulcs az `app-data` Docker-kötetben van (`/data`), újraépítéskor is megmarad. Ha a kötet
elveszik (például új szerverre költözéskor), a Beállításokban generálj új kulcsot. Saját
GitLab-szervernél, ha az SSH más gépen vagy porton fut: `GITLAB_SSH_HOST=git.example.com:2222`.

Kulcs helyett **token** is használható (az API-n olvas; ilyenkor minden felvett repóhoz ugyanaz a
token jár). Csak olvasási jogú token kell a `.env`-be:

- **GitHub:** Settings → Developer settings → *Fine-grained tokens* → Generate new token.
  Repository access: csak a hivatkozott repók; Permissions → Repository → **Contents: Read-only**.
  Szervezeti repónál a szervezetnek jóvá kell hagynia a tokent.
  ```ini
  GITHUB_TOKEN=github_pat_…
  ```
- **GitLab:** a projekt (vagy csoport) *Settings → Access tokens*: szerepkör Reporter,
  jogosultság **read_api**. Saját GitLab-szervernél a `GITLAB_URL`-t is add meg.
  ```ini
  GITLAB_TOKEN=glpat-…
  # GITLAB_URL=https://gitlab.example.com
  ```

Utána `docker compose up -d`. A projekt **Beállítások → Repók** részén a munkatér tulajdonosa
veszi fel, mely repókból lehet hivatkozni; ugyanott látszik, melyik repót mivel olvassa (kulccsal,
tokennel vagy nyilvánosan). A kulcs és a token is a szerveré: aki a projektben van, a felvett
repók fájljait látja, akkor is, ha a GitHubon nincs hozzáférése.

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
- Repós szakasz „nem található, vagy a szerver tokenje nem fér hozzá”: rossz útvonal vagy ág, vagy
  a token nem látja a repót (fine-grained tokennél a repót külön ki kell jelölni).
- „A repó nem fogadta el Teréz SSH-kulcsát”: a nyilvános kulcs nincs a repó Deploy keys részén
  (vagy egy másik repóhoz adtad; GitHubon egy deploy key csak egy repóhoz tartozhat).
- Helyi próba tunnel nélkül: `COMPOSE_PROFILES=`, `ORIGIN=http://localhost:3100`, és
  `http://localhost:3100` a szerveren (a Google-belépés ehhez a localhost callback-címet használja).
