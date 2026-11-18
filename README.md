# Director

A private, self-hosted AI image and video studio. It is a fork of
[Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI) (MIT)
reworked to run on your own provider accounts:

- **APIMart** and **Atlas Cloud** — every image and video model from their
  catalogs, refreshed daily, each labeled with provider and price;
- **your keys stay on your server** — the browser never sees them;
- **history and files on your server**, accounts for family and friends,
  optional monthly spending limits;
- **no third-party calls from the browser** — no analytics, no CDNs.

## Install on your computer (one command)

Mac / Linux: `curl -fsSL https://raw.githubusercontent.com/annoyingboiz/Open-Generative-AI/dz/step-2-gateway/install/install.sh | bash`
Windows (PowerShell): `irm https://raw.githubusercontent.com/annoyingboiz/Open-Generative-AI/dz/step-2-gateway/install/install.ps1 | iex`

Details: `docs/install.md`.

## Run it (manually)

```bash
git clone <this repo> director && cd director
cp .env.example .env          # set PORT and DATA_DIR if you like
docker compose up -d --build
```

Open `http://localhost:3300`, enter the one-time setup code from the gateway
log (`docker compose logs gateway`), create the admin account, then add your
provider keys in **Settings**.

A fuller guide (sharing with friends, adding a provider, updating) is in `docs/`.

## License

MIT — see `LICENSE`. Original work © the Open Generative AI authors.
