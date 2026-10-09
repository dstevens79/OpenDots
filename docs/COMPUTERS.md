# Local Dot computers

The local-computer option runs a real Google Chrome installation on the same Linux host as ACTUALLY Open Dots. Each Dot gets a separate persistent Chrome profile and files workspace under `/var/lib/opendots-computers`. Chrome runs on a private Xvfb display; the Dot's browser is shown and controlled through ACTUALLY Open Dots. The helper listens only on `127.0.0.1:4101`. The authenticated host manager proxies approved requests from the app to that loopback service. ACTUALLY Open Dots itself accepts authenticated LAN connections; the computer helper and machine-level harness API listeners stay private to the host.

This is a per-Dot browser workspace under a dedicated machine service account, not a separate Linux login or a shared RDP desktop. Each Dot gets its own persistent Chrome profile and files directory. The app remains the permission and audit boundary. Browser and file permissions still apply, and human takeover is available. The local Chrome computer does not expose host-shell execution; use a configured Harness for delegated coding and command-line tasks. The host manager and browser helper are installed as separate native services in separate folders; no containers are involved.

## Install on Ubuntu

1. Install the machine-level host manager once:

   ```sh
   sudo bash deployment/install-host-harness-manager.sh /opt/opendots
   ```

2. Install the same-machine Chrome computer service:

   ```sh
   sudo bash deployment/install-local-computer.sh /opt/opendots
   ```

   The installer adds Google Chrome and its runtime libraries, Bun, Xvfb, and the pinned OpenBot local computer helper. It creates persistent profile and workspace directories and a private token; the token is written to the server `.env` and root-managed systemd environment file. It does not expose the browser helper directly to the LAN.

3. Restart the native app service so it reads `COMPUTER_MODE=local-chrome` and `COMPUTER_TOKEN`:

   ```sh
   sudo systemctl restart opendots
   ```

4. In ACTUALLY Open Dots, open a Dot's **Computer** panel, enable its computer and the browser/files permissions it needs, then choose **Start**. Its browser profile survives app and service restarts.

The computer helper is pinned to a specific OpenBot commit in `deployment/install-local-computer.sh`. Review that pin and update it deliberately when refreshing the upstream dependency.

## Existing managed deployment

The `managed` mode remains available for compatible deployments that already provide an OpenBot supervisor and computer service. Set `COMPUTER_MODE=managed`, `COMPUTER_SUPERVISOR_URL`, `COMPUTER_SUPERVISOR_TOKEN`, and `COMPUTER_TOKEN`. The local Chrome setup is selected with `COMPUTER_MODE=local-chrome`; it uses the authenticated host manager configured by the host-manager installer. Keep these secrets on the server and do not expose the host manager token to browsers.

ACTUALLY Open Dots records start/stop, permission changes, owner control, and agent actions in its local database. Agent computer actions stop when agents are paused. Local Chrome files are scoped to its per-Dot workspace, not the host filesystem.
