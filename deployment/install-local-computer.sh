#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/opendots}"
OPENBOT_DIR="/opt/opendots-local-computer"
DATA_DIR="/var/lib/opendots-computers"
ENV_FILE="/etc/opendots-harness-manager.env"
COMPUTER_ENV_FILE="/etc/opendots-local-computer.env"
SERVICE_FILE="/etc/systemd/system/opendots-local-computer.service"
SUDOERS_FILE="/etc/sudoers.d/opendots-computer"
OPENBOT_COMMIT="aff4981e0734f15ff2fc68c86a32f765e0cae2b2"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi
if [[ ! -f "$APP_DIR/.env" || ! -f "$ENV_FILE" ]]; then
  echo "Install the ACTUALLY Open Dots host harness manager first." >&2
  exit 1
fi

ADMIN_ACCESS="${OPENDOTS_COMPUTER_ADMIN_ACCESS:-}"
if [[ -z "$ADMIN_ACCESS" && -t 0 ]]; then
  echo "Computer access for this machine:"
  echo "  1) Machine admin — Dot can use sudo for requested system tasks (recommended for a dedicated VM)."
  echo "  2) Workspace only — Dot stays inside its computer-service account."
  read -r -p "Choose [1/2, default 1]: " access_choice
  ADMIN_ACCESS="${access_choice:-1}"
fi
if [[ -z "$ADMIN_ACCESS" ]]; then
  ADMIN_ACCESS="restricted"
fi
case "$ADMIN_ACCESS" in
  1|yes|true|enabled|admin) ADMIN_ACCESS="enabled" ;;
  2|no|false|disabled|restricted) ADMIN_ACCESS="restricted" ;;
  *) echo "Set OPENDOTS_COMPUTER_ADMIN_ACCESS to 1 or 2." >&2; exit 2 ;;
esac

apt-get update
apt-get install -y ca-certificates curl git gnupg unzip xvfb fonts-liberation libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main\n' > /etc/apt/sources.list.d/google-chrome.list
apt-get update
apt-get install -y google-chrome-stable

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun
fi
if [[ ! -d "$OPENBOT_DIR/.git" ]]; then
  git clone --filter=blob:none https://github.com/CopilotKit/OpenBot.git "$OPENBOT_DIR"
fi
git -C "$OPENBOT_DIR" fetch --depth 1 origin "$OPENBOT_COMMIT"
git -C "$OPENBOT_DIR" checkout --detach "$OPENBOT_COMMIT"
python3 "$APP_DIR/deployment/patch-local-computer.py" "$OPENBOT_DIR"
cd "$OPENBOT_DIR"
bun install --frozen-lockfile
bun install --cwd agent-computer --frozen-lockfile

id opendots-computer >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin opendots-computer
chown -R opendots-computer:opendots-computer "$DATA_DIR"
install -d -o opendots-computer -g opendots-computer -m 0700 "$DATA_DIR" "$DATA_DIR/home"
if [[ "$ADMIN_ACCESS" == "enabled" ]]; then
  apt-get install -y sudo
  printf 'opendots-computer ALL=(ALL:ALL) NOPASSWD: ALL\n' > "$SUDOERS_FILE"
  chmod 0440 "$SUDOERS_FILE"
  visudo -cf "$SUDOERS_FILE"
else
  rm -f "$SUDOERS_FILE"
fi
computer_token="$(sed -n 's/^LOCAL_COMPUTER_TOKEN=//p' "$ENV_FILE")"
if [[ -z "$computer_token" ]]; then
  computer_token="$(openssl rand -hex 32)"
  printf '\nLOCAL_COMPUTER_TOKEN=%s\n' "$computer_token" >> "$ENV_FILE"
fi
sed -i '/^COMPUTER_TOKEN=/d' "$ENV_FILE"
printf 'COMPUTER_TOKEN=%s\n' "$computer_token" >> "$ENV_FILE"
chown root:opendots-harness "$ENV_FILE"
chmod 0640 "$ENV_FILE"
printf 'COMPUTER_TOKEN=%s\n' "$computer_token" > "$COMPUTER_ENV_FILE"
chown root:root "$COMPUTER_ENV_FILE"
chmod 0600 "$COMPUTER_ENV_FILE"
python3 - "$APP_DIR/.env" "$computer_token" "$ADMIN_ACCESS" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
lines = [line for line in path.read_text().splitlines() if not line.startswith(('COMPUTER_TOKEN=', 'COMPUTER_MODE=', 'COMPUTER_ADMIN_ACCESS='))]
lines += ['COMPUTER_TOKEN=' + sys.argv[2], 'COMPUTER_MODE=local-chrome']
if sys.argv[3] == 'enabled':
    lines.append('COMPUTER_ADMIN_ACCESS=true')
path.write_text('\n'.join(lines) + '\n')
PY

if [[ "$ADMIN_ACCESS" == "enabled" ]]; then
  SANDBOX_DIRECTIVES="PrivateTmp=true"
else
  SANDBOX_DIRECTIVES=$'NoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true'
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ACTUALLY Open Dots local Chrome computer service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opendots-computer
Group=opendots-computer
EnvironmentFile=$COMPUTER_ENV_FILE
Environment=COMPUTER_BROWSER_BACKEND=local-chrome
Environment=COMPUTER_BROWSER_MODE=headed
Environment=PORT=4101
Environment=OPENBOT_LOCAL_COMPUTER_DIR=$DATA_DIR
Environment=HOME=$DATA_DIR/home
Environment=COMPUTER_ALLOW_EXEC=on
# This native install has no remote policy controller to push per-Dot egress rules.
# Keep the service's built-in address protections while allowing normal web access.
Environment=EGRESS_POLICY_REQUIRED=false
ExecStart=/usr/local/bin/bun $OPENBOT_DIR/scripts/start-local-chrome-computer.ts
Restart=on-failure
RestartSec=3
ReadWritePaths=$DATA_DIR
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF
python3 - "$SERVICE_FILE" "$SANDBOX_DIRECTIVES" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
text = text.replace('ReadWritePaths=', sys.argv[2] + '\nReadWritePaths=', 1)
path.write_text(text)
PY
systemctl daemon-reload
systemctl enable --now opendots-local-computer.service
systemctl restart opendots-harness-manager.service
echo "Local Chrome computer installed. Restart ACTUALLY Open Dots to enable COMPUTER_MODE=local-chrome."
