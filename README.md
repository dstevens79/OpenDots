# OpenDots

**Open-source AI coworkers that run on your computer. No OpenDots subscription.**

Run the app, choose an AI endpoint you already use (local or remote), and create your own Dots. Connections start empty: add only the provider or local harness you want. Your workspace and conversations stay in your OpenDots database.

OpenDots is a community fork built with [AG-UI](https://docs.ag-ui.com/introduction), [TanStack AI](https://tanstack.com/ai), and the [CopilotKit React SDK](https://github.com/CopilotKit/CopilotKit). Its chat runtime is open-source and self-hosted. No CopilotKit Intelligence account, trial, key, or subscription is needed for chat, pages, or local Whisper dictation.

## Quick start

For a self-hosted Ubuntu 24.04 machine, run this once from its terminal:

```sh
sudo apt-get update && sudo apt-get install -y ca-certificates git && sudo git clone --depth 1 --single-branch --branch feat/self-hosted-sse-whisper https://github.com/dstevens79/OpenDots.git /opt/opendots && cd /opt/opendots && sudo bash scripts/install-ubuntu.sh
```

The installer enables access from other devices on your LAN by default and asks you to choose an OpenDots password. Choose **No** to keep access on the server itself. OpenDots stores only a salted password hash. Each service runs natively in its own install and data folders. No Docker containers are used. From another device, open `http://<server-ip>:4310`, then go to **Settings → Connections → Add a connection**. Enter the endpoint URL and API key for a service you choose, then select it under **Model roles**. For a local model gateway, use its OpenAI-compatible API URL; no provider is preconfigured. Provider fees, if any, are set by that provider. A local model endpoint can keep inference on your network.

For development or another operating system, use Node.js 24 and npm:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**.

For manual LAN deployments, configure owner password login as described in [Configuration and setup](docs/SETUP.md). See that guide for optional integrations.

## What you get

- A private workspace with Dots, pages, conversations, and SQLite persistence.
- Separate model connections for the resident AI and background housekeeping role.
- Optional machine-level harnesses (Hermes, OpenCode, Gemini CLI, Codex CLI, and Grok) that Dots can use through approved tasks. Install only the harnesses you choose; they are not required for ordinary chat.
- Per-Dot browser profiles and workspace files on a local computer service, with owner takeover, permissions, and an action log. The local computer mode uses installed Chrome on the same machine; it does not provide a general remote desktop login or expose the host shell to a Dot.
- Browser-based Whisper dictation, independently configurable from chat models.
- Optional voice and external integrations, which each require their own compatible provider or service.

See [Computer setup](docs/COMPUTERS.md), [Connections](docs/CONNECTIONS.md), and [Setup](docs/SETUP.md).

## Privacy and costs

The app itself has no subscription. It stores conversations and pages in its local database. A remote model endpoint receives the prompts and authorized context sent to it; a local endpoint can keep that traffic on your own machine. External research, voice, and messaging integrations are optional and can send data to their configured services. Review those providers' terms and costs before enabling them.

## Development

```sh
npm run typecheck
npm test
npm run build
```

Contributions and security reports: [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). OpenDots is licensed under MIT; see [LICENSE](LICENSE).
