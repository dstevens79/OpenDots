#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/opendots}"
MANAGER_DIR="/opt/opendots-host-harness-manager"
DATA_DIR="/var/lib/opendots-harnesses"
ENV_FILE="/etc/opendots-harness-manager.env"
SERVICE_FILE="/etc/systemd/system/opendots-harness-manager.service"
MANAGER_HOST="${HARNESS_MANAGER_HOST:-127.0.0.1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi
if [[ ! -f "$APP_DIR/deployment/host-harness-manager.py" ]]; then
  echo "Could not find the ACTUALLY Open Dots checkout at $APP_DIR." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg bubblewrap
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
if ! command -v bwrap >/dev/null 2>&1; then
  apt-get update
  apt-get install -y bubblewrap
fi
if ! dpkg-query -W -f='${Status}' libatomic1 2>/dev/null | grep -q 'install ok installed'; then
  apt-get update
  apt-get install -y libatomic1
fi
if command -v apparmor_parser >/dev/null 2>&1; then
  install -m 0644 "$APP_DIR/deployment/bwrap-userns-restrict.apparmor" /etc/apparmor.d/bwrap-userns-restrict
  apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
fi

id opendots-harness >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin opendots-harness
install -d -o opendots-harness -g opendots-harness -m 0750 "$MANAGER_DIR" "$DATA_DIR"
install -o root -g opendots-harness -m 0750 "$APP_DIR/deployment/host-harness-manager.py" "$MANAGER_DIR/manager.py"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 027
  printf 'HARNESS_MANAGER_TOKEN=%s\nLOCAL_COMPUTER_TOKEN=%s\nHARNESS_MANAGER_HOST=%s\nHARNESS_MANAGER_PORT=4312\nHERMES_PUBLIC_URL=http://%s:8642/v1\nOPENCODE_PUBLIC_URL=http://%s:4096\nOPENDOTS_HARNESSES_DIR=/var/lib/opendots-harnesses\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$MANAGER_HOST" "$MANAGER_HOST" "$MANAGER_HOST" > "$ENV_FILE"
fi
chown root:opendots-harness "$ENV_FILE"
chmod 0640 "$ENV_FILE"
manager_token="$(sed -n 's/^HARNESS_MANAGER_TOKEN=//p' "$ENV_FILE")"
computer_token="$(sed -n 's/^LOCAL_COMPUTER_TOKEN=//p' "$ENV_FILE")"
if [[ -z "$computer_token" ]]; then
  computer_token="$(openssl rand -hex 32)"
  printf '\nLOCAL_COMPUTER_TOKEN=%s\n' "$computer_token" >> "$ENV_FILE"
  chown root:opendots-harness "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi
if [[ -f "$APP_DIR/.env" ]]; then
  python3 - "$APP_DIR/.env" "$manager_token" "$computer_token" "http://$MANAGER_HOST:4312" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
lines = [line for line in path.read_text().splitlines() if not line.startswith(('HARNESS_MANAGER_TOKEN=', 'HARNESS_MANAGER_URL=', 'COMPUTER_TOKEN='))]
lines += ['HARNESS_MANAGER_TOKEN=' + sys.argv[2], 'HARNESS_MANAGER_URL=' + sys.argv[4], 'COMPUTER_TOKEN=' + sys.argv[3]]
path.write_text('\n'.join(lines) + '\n')
PY
else
  printf 'HARNESS_MANAGER_TOKEN=%s\nHARNESS_MANAGER_URL=http://%s:4312\nCOMPUTER_TOKEN=%s\nCOMPUTER_MODE=managed\n' "$manager_token" "$MANAGER_HOST" "$computer_token" > "$APP_DIR/.env"
  chown "$(stat -c '%U:%G' "$APP_DIR")" "$APP_DIR/.env"
fi
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ACTUALLY Open Dots machine-level harness manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opendots-harness
Group=opendots-harness
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/python3 $MANAGER_DIR/manager.py
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
systemctl daemon-reload
systemctl enable opendots-harness-manager.service
systemctl restart opendots-harness-manager.service
echo "Host harness manager installed and running. Token file: $ENV_FILE"
