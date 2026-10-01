# Deployment

This repository is a Ghost theme plus the tooling around it. Ghost itself is not in the repo, so to run the directory you host a Ghost 6 site and put the theme on it. This page covers both steps.

Two ways to host Ghost are described. Pick one.

| | Docker Compose | ghost-cli on Ubuntu |
| --- | --- | --- |
| What you get | Ghost, MySQL and Caddy (automatic HTTPS) as three containers | Ghost's official installer: system packages, nginx, systemd |
| Best for | A clean box, easy backups, easy to move | Matching Ghost's own documented production setup |
| Tested here | Compose file validated, Caddy proxy tested against a live Ghost 6.67.0 | Commands follow Ghost's install guide |
| Upgrades | `docker compose pull && docker compose up -d` | `ghost update` |

After Ghost is running, the steps are the same for both: [connect GitHub](#connect-github), [activate the theme](#first-deploy-and-activation), [seed content](#seed-the-directory), [create the Snippet](#create-the-snippet), [turn on comments](#members-and-comments).

## Requirements

- A server with at least 1 GB of RAM, which is Ghost's stated minimum. Ubuntu 22.04, 24.04 or 26.04 for the ghost-cli route.
- A domain name with a DNS A (and optionally AAAA) record pointing at the server, created before you start. Ghost must run on HTTPS.
- An SMTP account (any provider). Ghost uses it for staff logins and invites, password resets, member sign-in and native comments. This is separate from newsletter sending, which you do not need.
- This repository on GitHub (you already have it) and a machine with Node.js 22 to run the seed and lint scripts. Any laptop works.

Versions Ghost documents as supported: Node.js 22 LTS, MySQL 8.0 or 8.4 ([hosting requirements](https://docs.ghost.org/hosting)).

## Path A: Docker Compose

The stack lives in [`deploy/`](deploy/). It follows the layout of Ghost's official Docker setup ([TryGhost/ghost-docker](https://github.com/TryGhost/ghost-docker)) without the optional analytics and ActivityPub services.

| Service | Image | Purpose |
| --- | --- | --- |
| `caddy` | `caddy:2-alpine` | Public entry point on ports 80 and 443. Gets and renews the TLS certificate by itself |
| `ghost` | `ghost:6-alpine` | The site. Not published to the host |
| `db` | `mysql:8.4` | Database. Not published to the host |

Only Caddy publishes ports. Ghost and MySQL are reachable only on the internal compose network. Note that Docker publishes ports through its own firewall rules, which bypass ufw: if you rely on ufw, remember that anything you add under `ports:` is open.

### 1. Install Docker

Follow Docker's guide for [Docker Engine and the Compose plugin](https://docs.docker.com/engine/install/). `docker compose version` should print a version.

### 2. Configure

```bash
git clone https://github.com/arkhivar/ghost-harness.git
cd ghost-harness/deploy
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

- `DOMAIN`: the public domain, with no protocol.
- `DATABASE_PASSWORD`: a long random value, for example `openssl rand -hex 24`. Set it once. MySQL only reads it when it first creates the database, so changing it later does not change the stored password.
- The `mail__*` block: your SMTP details. Port 465 uses `secure=true`. Port 587 uses `secure=false` and upgrades with STARTTLS.

Everything in `.env` is passed into the Ghost container. That is how the `mail__*` settings reach Ghost, and it is why `.env` must stay out of git (the repository `.gitignore` already excludes it).

### 3. Start

```bash
docker compose up -d
docker compose ps
docker compose logs -f ghost      # wait for the boot message, then Ctrl+C
docker compose logs caddy         # shows the certificate being obtained
```

The first start takes a minute: MySQL initialises, then Ghost runs its migrations. A 502 from Caddy during that minute is normal.

### 4. Create the owner account

Open `https://<your domain>/ghost/` and create the owner account immediately. Until someone does, anyone who finds the URL can.

### Already have a reverse proxy

Skip Caddy. Create `deploy/docker-compose.override.yml`:

```yaml
services:
  caddy:
    profiles: ["bundled-proxy"]
  ghost:
    ports:
      - "127.0.0.1:2368:2368"
```

With the override in place, `docker compose up -d` starts only Ghost and MySQL, and Ghost listens on loopback port 2368. Verified with the compose parser: the services list is `db` and `ghost`, and Caddy returns only if you pass `--profile bundled-proxy`.

Your proxy must terminate TLS, pass the original host, and tell Ghost the request was HTTPS. Without the `X-Forwarded-Proto` header Ghost redirects in a loop. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:2368;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
}
```

`DOMAIN` in `.env` must still be the public domain, because Ghost builds all its URLs from it. The theme zip is about 200 KB, but raise `client_max_body_size` if you upload large images through the editor (nginx's default is 1 MB).

### Backups

Two things hold state: the database and the content folder (uploads, themes, settings files).

```bash
cd ghost-harness/deploy

# Database
docker compose exec -T db sh -c 'mysqldump --single-transaction --no-tablespaces -u ghost -p"$MYSQL_PASSWORD" ghost' \
  | gzip > ghost-db-$(date +%F).sql.gz

# Content folder
tar czf ghost-content-$(date +%F).tgz data/ghost
```

The dump uses the unprivileged `ghost` user, so it needs `--no-tablespaces`. The `$MYSQL_PASSWORD` is expanded inside the container, not by your shell.

Restore into a fresh stack:

```bash
docker compose up -d db
gunzip -c ghost-db-YYYY-MM-DD.sql.gz | docker compose exec -T db sh -c 'mysql -u ghost -p"$MYSQL_PASSWORD" ghost'
tar xzf ghost-content-YYYY-MM-DD.tgz
docker compose up -d
```

Also keep `.env` somewhere safe. Run a restore once on a spare machine before you need it. A backup you never restored is a guess.

The Caddy volume holds your TLS certificates. Losing it is harmless (Caddy requests new ones) but you may hit Let's Encrypt rate limits if it happens repeatedly.

### Updates

```bash
cd ghost-harness/deploy
# back up first (see above)
docker compose pull
docker compose up -d
```

`ghost:6-alpine` follows the latest Ghost 6.x release and Ghost migrates its own database on boot. Read the release notes before a major version change, and check the homepage afterwards: the theme relies on `{{content}}` inside a `{{#get}}` loop, which Ghost's docs do not describe (see [_GUIDE.md](_GUIDE.md), trick 2).

To pin a version, set `GHOST_VERSION` and `MYSQL_VERSION` in `.env`. Do not move an existing database between MySQL major versions casually.

## Path B: ghost-cli on Ubuntu

This follows Ghost's [Ubuntu install guide](https://docs.ghost.org/install/ubuntu), which is the authority if anything differs.

```bash
# As root: create a user. The name "ghost" is reserved by ghost-cli, so pick another.
adduser <user>
usermod -aG sudo <user>
su - <user>

# System packages
sudo apt-get update
sudo apt-get upgrade
sudo apt-get install nginx
sudo ufw allow 'Nginx Full'
sudo apt-get install mysql-server
```

Ghost does not support MySQL's socket authentication for root, so give root a password:

```bash
sudo mysql
```

```sql
ALTER USER 'root'@'localhost' IDENTIFIED WITH 'caching_sha2_password' BY '<your-new-root-password>';
FLUSH PRIVILEGES;
exit
```

Install Node.js 22 from NodeSource:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

NODE_MAJOR=22
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

sudo apt-get update
sudo apt-get install nodejs -y
```

Install Ghost:

```bash
sudo npm install ghost-cli@latest -g

sudo mkdir -p /var/www/harness
sudo chown <user>:<user> /var/www/harness
sudo chmod 775 /var/www/harness
cd /var/www/harness

ghost install
```

When asked, give the exact public URL with `https://` (not an IP address). With the DNS record already in place, ghost-cli can set up a Let's Encrypt certificate for you. You can also run `ghost setup ssl` later.

### Mail

Edit `/var/www/harness/config.production.json` and add a `mail` block, then run `ghost restart`:

```json
"mail": {
    "transport": "SMTP",
    "from": "'Harness Matrix' <noreply@example.com>",
    "options": {
        "host": "smtp.example.com",
        "port": 465,
        "secure": true,
        "auth": { "user": "postmaster@example.com", "pass": "change-me" }
    }
}
```

These keys are the same ones the Docker route sets as `mail__options__host` and so on. ghost-cli also accepts `ghost config --mail SMTP --mailhost ... --mailport ...` ([ghost-cli docs](https://docs.ghost.org/ghost-cli)).

### Day to day

```bash
ghost ls            # status
ghost log -f        # follow the log
ghost backup        # ghost-cli's own backup
ghost update        # upgrade (read release notes first)
ghost restart
```

## Connect GitHub

The workflow [`.github/workflows/deploy-theme.yml`](.github/workflows/deploy-theme.yml) uploads the theme to your site on every push to `main` that changes theme files. It needs two secrets.

1. In Ghost Admin open Settings, then Advanced, then Integrations, and choose Add custom integration. Name it `GitHub deploy`.
2. Copy the Admin API key and the API URL from the integration page.
3. In the GitHub repository open Settings, Secrets and variables, Actions, and add two repository secrets:
   - `GHOST_ADMIN_API_URL`: the API URL, which is your site's public address, for example `https://harness.example.com`.
   - `GHOST_ADMIN_API_KEY`: the Admin API key, in `id:secret` form. Copy the whole thing.

Until both secrets exist, the deploy workflow skips itself and stays green with a notice. The test workflow runs on every push and pull request and needs no secrets.

What the workflow does: it runs `npm run pack`, which builds `dist/ghost-harness.zip` containing only theme files, then hands that zip to [TryGhost/action-deploy-theme](https://github.com/TryGhost/action-deploy-theme). Shipping our own zip keeps scripts, tests, seed data and docs off your site.

## First deploy and activation

1. In GitHub open Actions, choose Deploy theme, and run the workflow manually. Or push any change to a theme file.
2. In Ghost Admin open Settings, then Site, then Theme, and choose Change theme. Open the Installed tab, find `ghost-harness`, and activate it.

The activation is needed once. The Action only uploads: it does not activate. After the theme is active, every later deploy replaces it in place and goes live immediately. Tested on Ghost 6.67.0: an upload-only call to an already-active theme changed the live homepage with no further step.

No GitHub? Run `npm run pack`, then in Ghost Admin open Settings, Site, Theme, Change theme, Upload theme, and pick `dist/ghost-harness.zip`.

Theme options (color scheme, footer note, homepage headline and intro, whether the homepage shows the latest notes) are under Settings, Site, Design & branding, Customize, on the Theme tab, in the Site wide and Homepage groups. Defaults work out of the box.

If a deploy fails with theme errors, run `npm run gscan` locally. It is Ghost's own validator and it prints the same report Ghost shows on upload.

## Seed the directory

The seed script creates one published post per harness, each with a filled facts block, from `seed/harnesses.json`. It currently holds 16 harnesses, written in neutral English and checked on 2026-10-01. Re-verify anything you rely on: products change quickly.

```bash
git clone https://github.com/arkhivar/ghost-harness.git
cd ghost-harness
npm ci

export GHOST_URL=https://harness.example.com
export GHOST_ADMIN_API_KEY=<id>:<secret>      # the custom integration key from above

npm run seed -- --dry-run     # shows what it would create
npm run seed                  # creates the posts
npm run lint:facts            # checks every facts block on the site
```

The script is safe to re-run: existing posts are skipped. Use `--update` to overwrite them with the seed content, or `--status draft` to create drafts first. It needs Node.js 22.

Open the homepage. The matrix should list all harnesses within a few seconds.

## Create the Snippet

The Snippet is what lets you add new harnesses from the editor with `/harness`. Creating it is a one-time step per site. Follow [_GUIDE.md](_GUIDE.md): by hand in the editor, or with `npm run snippet:sync` and a staff access token.

## Members and comments

Each post template includes Ghost's native comments. They need two things:

1. Working outgoing mail (the `mail__*` settings above), because commenters sign in with an emailed link.
2. Comments switched on: Settings, Membership, Access, then Edit, and choose who can comment (all members, or paid members only). Commenters must be members, so enable member sign-ups as you see fit under Membership.

To check that outgoing mail works, use Forgot password on the Ghost sign-in page. If the email arrives, Ghost can send mail.

## Optional: pretty URLs

[`config/routes.yaml`](config/routes.yaml) moves harness posts to `/harness/<slug>/`. In Ghost Admin open Settings, Advanced, Labs and upload the file in the routes section. Old `/<slug>/` URLs answer with a 301 redirect to the new ones, so existing links keep working (tested). To undo, upload Ghost's default routes file.

## Security checklist

- `.env` is mode 600 and never committed.
- The owner account is created right after the first start.
- The custom integration key lives only in GitHub secrets and your shell. Rotate it from the integration page if it leaks.
- A staff access token, if you use `snippet:sync`, lives only in your shell.
- Ports 80 and 443 are the only ones open (plus 443/udp for HTTP/3 if you keep it).
- Backups run on a schedule and you have tested a restore.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Caddy cannot get a certificate | `docker compose logs caddy`. The domain must resolve to this server and ports 80 and 443 must be reachable from the internet |
| Browser shows a redirect loop | Ghost's `url` must be the public https address. Behind your own proxy, send `X-Forwarded-Proto` |
| 502 right after `up -d` | Ghost is still starting. Watch `docker compose logs -f ghost` |
| Ghost restarts repeatedly | `docker compose logs ghost`. A database password that differs from the one MySQL first created is the usual cause |
| Staff login or invites never send email | The `mail__*` settings. Test with Forgot password |
| Deploy workflow is skipped | The two secrets are not set yet. The log says so |
| Deploy workflow fails with 401 or 404 | The API URL must be the site's public address, and the key must be the full `id:secret` |
| Theme uploaded but the site looks unchanged | The theme was never activated. Settings, Site, Theme, Change theme |
| Homepage matrix is empty | No published post has the `#harness` tag. Run the seed, or see [_GUIDE.md](_GUIDE.md) |
