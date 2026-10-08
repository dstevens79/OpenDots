#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="/var/lib/opendots"
SERVICE_FILE="/etc/systemd/system/opendots.service"
ENV_FILE="$APP_DIR/.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo: sudo bash scripts/install-ubuntu.sh" >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]] || ! grep -q '^ID=ubuntu$' /etc/os-release || ! grep -q '^VERSION_ID="24.04"$' /etc/os-release; then
  echo "The one-command installer currently supports Ubuntu 24.04. Use the manual Node.js setup on other systems." >&2
  exit 1
fi
if [[ ! -f "$APP_DIR/package.json" || ! -f "$APP_DIR/package-lock.json" ]]; then
  echo "Run this script from an OpenDots checkout." >&2
  exit 1
fi

echo "This installs OpenDots and selected helpers as native Ubuntu services. No Docker containers are used."
read -r -p "Allow access from other devices on your LAN? [y/N] " expose_lan
owner_username=""
runtime_token=""
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  owner_username="$(sed -n 's/^OWNER_USERNAME=//p' "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$owner_username" ]]; then
    owner_username="${SUDO_USER:-}"
  fi
  if [[ -z "$owner_username" ]]; then
    read -r -p "Linux account for password login: " owner_username
  fi
  if ! id "$owner_username" >/dev/null 2>&1; then
    echo "Linux account '$owner_username' does not exist." >&2
    exit 1
  fi
fi
read -r -p "Install optional machine-level Harnesses? [y/N] " install_harnesses
if [[ "$install_harnesses" =~ ^[Yy]$ ]]; then
  install_manager="y"
  read -r -p "Which harnesses should be installed now? 1 Hermes, 2 OpenCode, 3 Gemini CLI, 4 Codex CLI, 5 Grok CLI (comma-separated, blank for none): " harness_choices
else
  install_manager="n"
  harness_choices=""
fi
read -r -p "Install the optional per-Dot local Chrome computer workspace? [y/N] " install_computer
if [[ "$install_computer" =~ ^[Yy]$ ]]; then
  install_manager="y"
fi
read -r -p "Install the optional local public-page browser reader? [y/N] " install_browser

apt-get update
apt-get install -y ca-certificates curl git libpam0g openssl python3
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  runtime_token="$(openssl rand -hex 32)"
fi
if [[ ! -x /usr/bin/node || ! -x /usr/bin/npm ]] || [[ "$(/usr/bin/node -p 'Number(process.versions.node.split(".")[0])')" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

id opendots >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin opendots
install -d -o opendots -g opendots -m 0750 "$DATA_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  touch "$ENV_FILE"
fi
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  bind_host="0.0.0.0"
  cat > /etc/pam.d/opendots <<'PAM'
@include common-auth
@include common-account
PAM
else
  bind_host="127.0.0.1"
fi
python3 - "$ENV_FILE" "$bind_host" "$DATA_DIR/opendots.sqlite" "$owner_username" "$runtime_token" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
values = {
    'HOST': sys.argv[2],
    'PORT': '4310',
    'DATABASE_PATH': sys.argv[3],
    'OWNER_ID': 'opendots-owner',
    'DO_NOT_TRACK': '1',
    'COPILOTKIT_TELEMETRY_DISABLED': 'true',
}
if sys.argv[4]:
    values['OWNER_USERNAME'] = sys.argv[4]
if sys.argv[5]:
    values['RUNTIME_TOKEN'] = sys.argv[5]
lines = path.read_text().splitlines()
for key in (*values.keys(), 'OWNER_TOKEN', 'OWNER_USERNAME', 'RUNTIME_TOKEN'):
    lines = [line for line in lines if not line.startswith(key + '=')]
for key, value in values.items():
    lines.append(f'{key}={value}')
path.write_text('\n'.join(lines) + '\n')
PY
chown root:opendots "$ENV_FILE"
chmod 0640 "$ENV_FILE"

cd "$APP_DIR"
npm_bin="/usr/bin/npm"
"$npm_bin" ci --no-audit --no-fund
"$npm_bin" run build
node_bin="/usr/bin/node"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=OpenDots self-hosted AI workspace
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opendots
Group=opendots
WorkingDirectory=$APP_DIR
ExecStart=$node_bin --env-file-if-exists=.env dist/server/server/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

if [[ "$install_manager" =~ ^[Yy]$ ]]; then
  HARNESS_MANAGER_HOST=127.0.0.1 bash "$APP_DIR/deployment/install-host-harness-manager.sh" "$APP_DIR"
  manager_token="$(sed -n 's/^HARNESS_MANAGER_TOKEN=//p' "$APP_DIR/.env")"
  for choice in ${harness_choices//,/ }; do
    case "$choice" in
      1) harness="hermes" ;;
      2) harness="opencode" ;;
      3) harness="gemini" ;;
      4) harness="codex" ;;
      5) harness="grok" ;;
      *) echo "Skipping unknown harness choice: $choice"; continue ;;
    esac
    curl -fsS -X POST http://127.0.0.1:4312/install \
      -H "Authorization: Bearer $manager_token" \
      -H 'Content-Type: application/json' \
      --data "{\"harness\":\"$harness\"}" >/dev/null
    echo "Started optional $harness installation."
  done
fi
if [[ "$install_computer" =~ ^[Yy]$ ]]; then
  bash "$APP_DIR/deployment/install-local-computer.sh" "$APP_DIR"
fi
if [[ "$install_browser" =~ ^[Yy]$ ]]; then
  bash "$APP_DIR/deployment/install-local-browser-reader.sh" "$APP_DIR"
fi

systemctl daemon-reload
systemctl enable opendots.service
systemctl restart opendots.service
echo
echo "OpenDots is installed and running. Open http://localhost:4310, then add a model connection in Settings."
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  echo "LAN access is enabled. Sign in with the password for Linux account $owner_username."
fi
echo "Optional harnesses are installed from Settings → Harnesses; choose only the ones you want."
