# Setup and operation

ACTUALLY Open Dots is designed for one person running it on their own computer or home server. The app and its database run on that machine. You choose which model endpoint and optional machine-level tools to connect.

## First run

For a native Ubuntu 24.04 install, use the one-command setup in the [README](../README.md#quick-start). The installer creates separate native systemd services for the app and any optional Harnesses, Chrome workspace, or public-page reader you select. Each service has its own machine account where practical and keeps persistent state in its own `/var/lib/opendots-*` directory. No Docker containers are used.

After opening ACTUALLY Open Dots:

1. Open **Settings → Connections** and add only the model endpoints you want. Each saved connection holds its endpoint, model default, and API key once.
2. Open **Settings → Model roles** and choose a connection and model for Resident AI. Choose a separate Housekeeping model if you want background work to use another one; it can share the same saved connection.
3. Open **Settings → Harnesses** to install optional machine-level tools. Install only what you plan to use. The Harnesses manager is separate from the app and runs as a restricted system service.
4. Open **Settings → Voice** to configure realtime voice separately from chat. Browser Whisper dictation is local and does not use the voice-call provider.

An endpoint can be a local model gateway, OmniRoute, or another OpenAI-compatible service. ACTUALLY Open Dots does not include or charge for a model. Remote providers may charge for their API; a local endpoint can keep model requests on your own network.

## Home network access

The installer defaults to LAN access (`HOST=0.0.0.0`) and asks you to choose and confirm an ACTUALLY Open Dots password. Choose **No** at the LAN prompt to bind only to the server itself. ACTUALLY Open Dots saves only a salted scrypt hash, never the password. A short-lived, HttpOnly browser session keeps you signed in for 12 hours; the installer also keeps a private internal service token for local agent requests. To change the binding later, edit `.env` in `/opt/opendots` and restart:

```sh
sudo systemctl restart opendots
```

For LAN access, keep `HOST=0.0.0.0`, `OWNER_PASSWORD_HASH`, and a private `RUNTIME_TOKEN`. The native installer handles these settings. For a manual install, create the hash by entering a password into `scripts/hash-password.py` on stdin; do not put the plain password in `.env` or a shell command. The `RUNTIME_TOKEN` is for internal local agent requests and is not the login password. The app is reachable on your LAN at `http://<server-ip>:4310`; the helper services remain loopback-only and are reached through the app.

## Local computer workspace

The optional local Chrome service provides a persistent browser profile and files area for each Dot on the same Ubuntu host. It uses the app's Computer panel for browser view and owner takeover. This is not a separate Linux account or full remote desktop. Local Chrome does not expose a terminal; use a Harness for delegated command-line work.

The installer sets up the helper and persistent directories. To install it later, install the Harnesses manager first, then run:

```sh
sudo bash /opt/opendots/deployment/install-local-computer.sh /opt/opendots
sudo systemctl restart opendots
```

Enable a Dot's computer, browser, and files permissions in its Computer panel, then start it. Profile data lives under `/var/lib/opendots-computers`; back it up if you want to preserve browser sign-ins. The host manager remains bound to loopback for the native install.

## Data and backups

Native installation stores the app database at `/var/lib/opendots/opendots.sqlite`. It contains pages, conversations, model connection settings, and application state. Stop the service before copying the database and its `-wal`/`-shm` companions, or use SQLite's online backup API. Store backups with the same care as the machine: provider API keys are currently kept in the database so the app can use them.

Harness workspaces and local Chrome profiles are stored separately under `/var/lib/opendots-harnesses` and `/var/lib/opendots-computers`. Back up only the data you want to keep. Do not include `.env` or service token files in public repositories.

## Optional integrations

Public web research is off by default. It can be enabled with `WEB_SEARCH_PROVIDER=parallel` or `browser`; those options send search requests or URLs to their configured services. Keep it disabled for a fully local conversation path.

The optional public-page reader runs as a separate native service, bound to loopback, with an isolated browser installation and a private bearer secret. Install it with `sudo bash /opt/opendots/deployment/install-local-browser-reader.sh /opt/opendots`; it enables `WEB_SEARCH_PROVIDER=browser`. Its Chromium process fetches public pages when the configured research feature requests them.

ACTUALLY Open Dots keeps conversation history, scheduled task runs, computer actions, and explicit owner-written memories in its local SQLite database. A Dot can use saved memories when memory is enabled. It does not silently train a model or automatically promote conversation content into memory. The old hosted Learning and Slack Channels adapters have been removed. Native Slack and Discord bots are not included yet; a configured MCP connection can provide a bridge when you already run a compatible service.

The app does not send ACTUALLY Open Dots setup or usage analytics to a hosted dashboard. CopilotKit SDK telemetry is disabled by default for self-hosted installs. Operational history needed by the app remains in the local database and can be backed up with it.

Realtime voice calls use a separate compatible voice endpoint and credentials. They are optional; ordinary chat and local Whisper dictation work without them.

## Developer setup

Use Node.js 24 and npm:

```sh
npm ci
cp .env.example .env
npm run dev
```

The development UI is at `http://localhost:5173`; the API is on port `4310`. Run `npm run typecheck`, `npm test`, and `npm run build` before contributing.
