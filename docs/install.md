# Install Director on your computer

Director runs in Docker on your own Mac, Windows or Linux computer. Your keys,
history and files stay on that computer.

You need: **Docker Desktop** (the installer offers to install it), about 10 GB of
free disk, 8 GB of RAM or more, and keys for at least one provider (APIMart,
Atlas Cloud, fal.ai) — you add them in the app.

## Mac / Linux

Open **Terminal** and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/annoyingboiz/Open-Generative-AI/dz/step-2-gateway/install/install.sh | bash
```

## Windows

Open **PowerShell** and paste:

```powershell
irm https://raw.githubusercontent.com/annoyingboiz/Open-Generative-AI/dz/step-2-gateway/install/install.ps1 | iex
```

## What happens

1. The installer checks Docker (and offers to install Docker Desktop).
2. It puts Director into `~/Director` (Windows: `%USERPROFILE%\Director`).
3. It builds and starts it — the first time takes 5–10 minutes.
4. Your browser opens the first-start page with the setup code filled in:
   create your admin account.
5. In **Settings** paste your provider keys (links to get them are next to each
   field). Optional: **Connect ChatGPT** to use your ChatGPT plan for prompts —
   on your own computer it connects by itself.

## Every day

- Open `http://localhost:3300` (or the port the installer printed).
- **Update:** run the same command again — data, keys and accounts stay.
- **Stop / start / logs:** the installer prints the commands at the end.

## Options

Set before running: `DIRECTOR_DIR` (where to install), `DIRECTOR_PORT` (default
3300), `DIRECTOR_BRANCH`, `DIRECTOR_REPO`.
