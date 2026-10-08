#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/opendots}"
BROWSER_DIR="/opt/opendots-browser"
DATA_DIR="/var/lib/opendots-browser"
ENV_FILE="/etc/opendots-browser.env"
SERVICE_FILE="/etc/systemd/system/opendots-browser.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi
if [[ ! -f "$APP_DIR/package.json" || ! -f "$APP_DIR/dist/server/browser/index.js" ]]; then
  echo "Build OpenDots first; expected the browser service in $APP_DIR." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates
id opendots-browser >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin opendots-browser
install -d -o opendots-browser -g opendots-browser -m 0750 "$BROWSER_DIR" "$BROWSER_DIR/chromium" "$DATA_DIR"

export PLAYWRIGHT_BROWSERS_PATH="$BROWSER_DIR/chromium"
cd "$APP_DIR"
/usr/bin/npx playwright install-deps chromium
/usr/bin/npx playwright install chromium
chown -R root:opendots-browser "$BROWSER_DIR"
chmod -R u=rwX,g=rX,o= "$BROWSER_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  umask 027
  printf 'BROWSER_SECRET=%s\nBROWSER_HOST=127.0.0.1\nBROWSER_PORT=4311\n' "$(openssl rand -hex 32)" > "$ENV_FILE"
fi
browser_secret="$(sed -n 's/^BROWSER_SECRET=//p' "$ENV_FILE")"
if [[ -z "$browser_secret" || "${#browser_secret}" -lt 24 ]]; then
  echo "$ENV_FILE must contain a BROWSER_SECRET of at least 24 characters." >&2
  exit 1
fi
chown root:opendots-browser "$ENV_FILE"
chmod 0640 "$ENV_FILE"

python3 - "$APP_DIR/.env" "$browser_secret" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
lines = [line for line in path.read_text().splitlines() if not line.startswith(('BROWSER_URL=', 'BROWSER_SECRET=', 'BROWSER_HOST=', 'BROWSER_PORT=', 'WEB_SEARCH_PROVIDER='))]
lines += ['BROWSER_URL=http://127.0.0.1:4311', 'BROWSER_SECRET=' + sys.argv[2], 'WEB_SEARCH_PROVIDER=browser']
path.write_text('\n'.join(lines) + '\n')
PY
chown root:opendots "$APP_DIR/.env"
chmod 0640 "$APP_DIR/.env"

if [[ ! -x /usr/bin/node ]]; then
  echo "Install Node.js 24 system-wide before installing the browser reader." >&2
  exit 1
fi
node_bin="/usr/bin/node"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=OpenDots local public-page browser reader
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opendots-browser
Group=opendots-browser
EnvironmentFile=$ENV_FILE
Environment=PLAYWRIGHT_BROWSERS_PATH=$BROWSER_DIR/chromium
Environment=XDG_CACHE_HOME=$DATA_DIR/cache
WorkingDirectory=$APP_DIR
ExecStart=$node_bin dist/server/browser/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now opendots-browser.service
echo "Local browser reader installed in $BROWSER_DIR and running as opendots-browser."
