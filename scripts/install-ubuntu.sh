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
read -r -p "Allow access from other devices on your LAN? [Y/n] " expose_lan
if [[ -z "$expose_lan" ]]; then
  expose_lan="y"
fi
owner_password=""
owner_password_confirm=""
owner_password_hash=""
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  read -r -s -p "Choose an OpenDots password (at least 8 characters): " owner_password
  echo
  read -r -s -p "Confirm the OpenDots password: " owner_password_confirm
  echo
  if [[ "${#owner_password}" -lt 8 || "$owner_password" != "$owner_password_confirm" ]]; then
    echo "Passwords must match and be at least 8 characters." >&2
    exit 1
  fi
fi
read -r -p "Install optional machine-level Harnesses? [y/N] " install_harnesses
if [[ "$install_harnesses" =~ ^[Yy]$ ]]; then
  install_manager="y"
  echo
  echo "Machine-level Harnesses to install:"
  printf '  1  Hermes CLI\n  2  OpenCode CLI\n  3  Gemini CLI\n  4  Codex CLI\n  5  Grok CLI\n'
  read -r -p 'Choose numbers separated by commas, "all", or Enter for none: ' harness_choices
  harness_choices="$(printf '%s' "$harness_choices" | tr -d '[:space:]')"
  if [[ "${harness_choices,,}" == "all" ]]; then
    harness_choices="1,2,3,4,5"
  fi
else
  install_manager="n"
  harness_choices=""
fi
read -r -p "Install the optional per-Dot local Chrome computer workspace? [y/N] " install_computer
if [[ "$install_computer" =~ ^[Yy]$ ]]; then
  install_manager="y"
fi
read -r -p "Install the optional local public-page browser reader? [y/N] " install_browser
configure_ufw="n"
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  read -r -p "Add a UFW allow rule for OpenDots on TCP port 4310? [y/N] " configure_ufw
fi

apt-get update
apt-get install -y ca-certificates curl openssl python3
if [[ "$configure_ufw" =~ ^[Yy]$ ]] && ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y ufw
fi
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  owner_password_hash="$(printf '%s' "$owner_password" | python3 "$APP_DIR/scripts/hash-password.py")"
  unset owner_password owner_password_confirm
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
else
  bind_host="127.0.0.1"
fi
python3 - "$ENV_FILE" "$bind_host" "$DATA_DIR/opendots.sqlite" "$owner_password_hash" <<'PY'
import pathlib, secrets, sys
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
    values['OWNER_PASSWORD_HASH'] = sys.argv[4]
    values['RUNTIME_TOKEN'] = secrets.token_hex(32)
lines = path.read_text().splitlines()
for key in (*values.keys(), 'OWNER_TOKEN', 'OWNER_PASSWORD_HASH', 'OWNER_USERNAME', 'RUNTIME_TOKEN'):
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
  if [[ -n "$harness_choices" ]]; then
    echo
    echo "Waiting for the local Harness manager to become ready..."
    manager_ready="n"
    for _ in {1..30}; do
      if curl --silent --output /dev/null --max-time 2 http://127.0.0.1:4312/status; then
        manager_ready="y"
        break
      fi
      sleep 1
    done
    if [[ "$manager_ready" != "y" ]]; then
      echo "The Harness manager did not start listening on 127.0.0.1:4312 within 30 seconds." >&2
      echo "Check it with: sudo systemctl status opendots-harness-manager" >&2
      journalctl -u opendots-harness-manager -n 30 --no-pager >&2 || true
      exit 1
    fi
  fi
  for choice in ${harness_choices//,/ }; do
    case "$choice" in
      1) harness="hermes" ;;
      2) harness="opencode" ;;
      3) harness="gemini" ;;
      4) harness="codex" ;;
      5) harness="grok" ;;
      *) echo "Unknown harness choice: $choice. Choose 1-5, all, or leave blank." >&2; exit 1 ;;
    esac
    curl -fsS -X POST http://127.0.0.1:4312/install \
      -H "Authorization: Bearer $manager_token" \
      -H 'Content-Type: application/json' \
      --data "{\"harness\":\"$harness\"}" >/dev/null
    echo "Queued $harness installation."
  done
  if [[ -n "$harness_choices" ]]; then
    echo "Selected Harnesses will finish installing in the background. Check Settings → Harnesses for their status."
  fi
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
if [[ "$configure_ufw" =~ ^[Yy]$ ]]; then
  ufw allow 4310/tcp comment 'OpenDots LAN access'
  if ufw status | grep -q '^Status: active'; then
    echo "UFW now allows TCP 4310 for OpenDots."
  else
    echo "The UFW rule was added, but UFW is inactive; the rule will apply only if you enable UFW later."
    echo "UFW was not enabled automatically, so existing remote-access rules are unchanged."
  fi
fi
echo
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  echo "LAN access is enabled. Sign in with the OpenDots password you set during installation."
  access_ip="$(hostname -I | awk '{print $1}')"
  echo "Open http://${access_ip:-localhost}:4310 from another device on your LAN."
else
  echo "OpenDots is installed and running locally. Open http://localhost:4310."
fi
echo "Then add a model connection in Settings."
echo "Optional harnesses are installed from Settings → Harnesses; choose only the ones you want."
