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
  echo "Run this script from an ACTUALLY Open Dots checkout." >&2
  exit 1
fi

echo "This installs ACTUALLY Open Dots and selected helpers as native Ubuntu services. No Docker containers are used."
expose_lan="y"
want_hermes="n"
want_opencode="n"
want_gemini="n"
want_codex="n"
want_grok="n"
install_computer="n"
install_browser="n"
configure_ufw="n"
enable_https="n"

toggle_option() {
  local name="$1"
  local value="${!name}"
  if [[ "$value" == "y" ]]; then
    printf -v "$name" 'n'
  else
    printf -v "$name" 'y'
  fi
}

show_harness_menu() {
  while true; do
    echo
    echo "Machine-level Harnesses (select a number to toggle it):"
    printf '  1) Hermes CLI: %s\n' "$([[ "$want_hermes" == "y" ]] && echo On || echo Off)"
    printf '  2) OpenCode CLI: %s\n' "$([[ "$want_opencode" == "y" ]] && echo On || echo Off)"
    printf '  3) Gemini CLI: %s\n' "$([[ "$want_gemini" == "y" ]] && echo On || echo Off)"
    printf '  4) Codex CLI: %s\n' "$([[ "$want_codex" == "y" ]] && echo On || echo Off)"
    printf '  5) Grok CLI: %s\n' "$([[ "$want_grok" == "y" ]] && echo On || echo Off)"
    echo '  6) Select all'
    echo '  7) Clear all'
    echo '  0) Back to setup options'
    read -r -p 'Harness choice: ' harness_option
    case "$harness_option" in
      1) toggle_option want_hermes ;;
      2) toggle_option want_opencode ;;
      3) toggle_option want_gemini ;;
      4) toggle_option want_codex ;;
      5) toggle_option want_grok ;;
      6) want_hermes=y; want_opencode=y; want_gemini=y; want_codex=y; want_grok=y ;;
      7) want_hermes=n; want_opencode=n; want_gemini=n; want_codex=n; want_grok=n ;;
      0) return ;;
      *) echo 'Choose 0-7.' ;;
    esac
  done
}

while true; do
  harness_summary="None"
  for entry in "1:Hermes:$want_hermes" "2:OpenCode:$want_opencode" "3:Gemini:$want_gemini" "4:Codex:$want_codex" "5:Grok:$want_grok"; do
    IFS=: read -r _ number enabled <<< "$entry"
    if [[ "$enabled" == "y" ]]; then
      [[ "$harness_summary" == "None" ]] && harness_summary="" || harness_summary+=", "
      harness_summary+="$number"
    fi
  done
  [[ "$expose_lan" == "y" ]] && lan_summary="On (LAN)" || lan_summary="Off (this machine only)"
  [[ "$install_computer" == "y" ]] && computer_summary="On" || computer_summary="Off"
  [[ "$install_browser" == "y" ]] && browser_summary="On" || browser_summary="Off"
  [[ "$configure_ufw" == "y" ]] && ufw_summary="Allow TCP 4310" || ufw_summary="No change"
  if [[ "$enable_https" == "y" && "$configure_ufw" == "y" ]]; then
    ufw_summary="Allow TCP 4310, 443"
  fi
  [[ "$enable_https" == "y" ]] && https_summary="On (private local CA; trust it on each device)" || https_summary="Off"
  echo
  echo "ACTUALLY Open Dots setup options"
  echo '  1) Network access:          '"$lan_summary"
  echo '  2) Machine-level Harnesses: '"$harness_summary"
  echo '  3) Local Chrome workspace:  '"$computer_summary"
  echo '  4) Local page reader:       '"$browser_summary"
  echo '  5) UFW firewall:            '"$ufw_summary"
  echo '  6) HTTPS (private CA):      '"$https_summary"
  echo '  7) Continue with install'
  read -r -p 'Choose an option to change, or 7 to continue: ' setup_option
  case "$setup_option" in
    1)
      toggle_option expose_lan
      if [[ "$expose_lan" != "y" ]]; then configure_ufw=n; fi
      ;;
    2) show_harness_menu ;;
    3) toggle_option install_computer ;;
    4) toggle_option install_browser ;;
    5)
      if [[ "$expose_lan" == "y" ]]; then
        toggle_option configure_ufw
      else
        echo 'UFW access is available when LAN access is enabled.'
      fi
      ;;
    6)
      toggle_option enable_https
      if [[ "$enable_https" == "y" ]]; then
        echo 'HTTPS will use a private local certificate authority.'
        echo 'Each browser device must trust the generated CA certificate before microphone access is allowed.'
      fi
      ;;
    7) break ;;
    *) echo 'Choose 1-7.' ;;
  esac
done

install_manager="n"
harness_choices=""
[[ "$want_hermes" == "y" ]] && harness_choices+="1 "
[[ "$want_opencode" == "y" ]] && harness_choices+="2 "
[[ "$want_gemini" == "y" ]] && harness_choices+="3 "
[[ "$want_codex" == "y" ]] && harness_choices+="4 "
[[ "$want_grok" == "y" ]] && harness_choices+="5 "
if [[ -n "$harness_choices" || "$install_computer" == "y" ]]; then
  install_manager="y"
fi

owner_password=""
owner_password_confirm=""
owner_password_hash=""
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  read -r -s -p "Choose an ACTUALLY Open Dots password (at least 8 characters): " owner_password
  echo
  read -r -s -p "Confirm the password: " owner_password_confirm
  echo
  if [[ "${#owner_password}" -lt 8 || "$owner_password" != "$owner_password_confirm" ]]; then
    echo "Passwords must match and be at least 8 characters." >&2
    exit 1
  fi
fi
apt-get update
apt-get install -y ca-certificates curl openssl python3
if [[ "$configure_ufw" =~ ^[Yy]$ ]] && ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y ufw
fi
if [[ "$enable_https" =~ ^[Yy]$ ]] && ! command -v nginx >/dev/null 2>&1; then
  apt-get install -y nginx
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
app_port="4310"
if [[ "$enable_https" =~ ^[Yy]$ ]]; then
  bind_host="127.0.0.1"
  app_port="4311"
fi
python3 - "$ENV_FILE" "$bind_host" "$DATA_DIR/opendots.sqlite" "$owner_password_hash" "$app_port" <<'PY'
import pathlib, secrets, sys
path = pathlib.Path(sys.argv[1])
values = {
    'HOST': sys.argv[2],
    'PORT': sys.argv[5],
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
Description=ACTUALLY Open Dots self-hosted AI workspace
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

lan_ip="$(hostname -I | awk '{print $1}')"
access_ip="${lan_ip:-localhost}"
if [[ "$expose_lan" != "y" ]]; then
  access_ip="localhost"
fi
had_opendots_nginx_site="n"
if [[ -e /etc/nginx/sites-enabled/opendots-selfhosted.conf || -L /etc/nginx/sites-enabled/opendots-selfhosted.conf ]]; then
  had_opendots_nginx_site="y"
fi
if [[ "$enable_https" =~ ^[Yy]$ ]]; then
  cert_ip="${lan_ip:-127.0.0.1}"
  tls_dir="/etc/opendots/tls"
  nginx_site="/etc/nginx/sites-available/opendots-selfhosted.conf"
  nginx_enabled="/etc/nginx/sites-enabled/opendots-selfhosted.conf"
  install -d -o root -g root -m 0755 "$tls_dir"

  # Keep the CA private key on the server and issue a leaf certificate for this host.
  if [[ ! -s "$tls_dir/ca.key" || ! -s "$tls_dir/opendots-local-ca.crt" ]]; then
    openssl genrsa -out "$tls_dir/ca.key" 3072
    chmod 0600 "$tls_dir/ca.key"
    openssl req -x509 -new -sha256 -days 3650 -key "$tls_dir/ca.key" \
      -out "$tls_dir/opendots-local-ca.crt" \
      -subj "/CN=ACTUALLY Open Dots Local CA" \
      -addext 'basicConstraints=critical,CA:TRUE' \
      -addext 'keyUsage=critical,keyCertSign,cRLSign' \
      -addext 'subjectKeyIdentifier=hash'
  fi
  openssl genrsa -out "$tls_dir/server.key" 2048
  openssl req -new -key "$tls_dir/server.key" -out "$tls_dir/server.csr" \
    -subj "/CN=$cert_ip"
  cat > "$tls_dir/server.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$cert_ip
EOF
  openssl x509 -req -sha256 -days 825 -in "$tls_dir/server.csr" \
    -CA "$tls_dir/opendots-local-ca.crt" -CAkey "$tls_dir/ca.key" \
    -CAcreateserial -out "$tls_dir/server.crt" -extfile "$tls_dir/server.ext"
  chmod 0644 "$tls_dir/opendots-local-ca.crt" "$tls_dir/server.crt"
  chown root:www-data "$tls_dir/server.key"
  chmod 0640 "$tls_dir/server.key"
  rm -f "$tls_dir/server.csr" "$tls_dir/server.ext" "$tls_dir/ca.srl"

  if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
    nginx_http_listen="0.0.0.0:4310"
    nginx_https_listen="0.0.0.0:443"
  else
    nginx_http_listen="127.0.0.1:4310"
    nginx_https_listen="127.0.0.1:443"
  fi
  cat > "$nginx_site" <<EOF
server {
    listen $nginx_http_listen;
    server_name _;

    location = /opendots-local-ca.crt {
        alias $tls_dir/opendots-local-ca.crt;
        default_type application/x-x509-ca-cert;
        add_header Content-Disposition 'attachment; filename="opendots-local-ca.crt"';
    }

    location / {
        return 308 https://\$host\$request_uri;
    }
}

server {
    listen $nginx_https_listen ssl;
    server_name _;
    ssl_certificate $tls_dir/server.crt;
    ssl_certificate_key $tls_dir/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:4311;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 360s;
        proxy_send_timeout 360s;
    }
}
EOF
  ln -sfn "$nginx_site" "$nginx_enabled"
else
  access_ip="${access_ip:-localhost}"
  # Remove only the site owned by this installer so the app can bind port 4310.
  rm -f /etc/nginx/sites-enabled/opendots-selfhosted.conf \
    /etc/nginx/sites-available/opendots-selfhosted.conf
fi

if [[ "$enable_https" =~ ^[Yy]$ || "$had_opendots_nginx_site" == "y" ]]; then
  nginx -t
fi

systemctl daemon-reload
systemctl enable opendots.service
systemctl stop opendots.service || true
if [[ "$enable_https" =~ ^[Yy]$ ]]; then
  systemctl enable nginx
  systemctl restart nginx
elif [[ "$had_opendots_nginx_site" == "y" ]] && systemctl is-active --quiet nginx; then
  systemctl reload nginx
fi
systemctl restart opendots.service
echo
echo "Set up model access now? You can connect OmniRoute, OpenRouter, or any OpenAI-compatible endpoint."
if [[ -t 0 ]]; then
  runuser -u opendots -- "$node_bin" --import tsx "$APP_DIR/scripts/configure-initial-models.ts" "$DATA_DIR/opendots.sqlite"
else
  echo "Skipping interactive model setup because this installer has no terminal. Run Settings → Connections after signing in."
fi
if [[ "$configure_ufw" =~ ^[Yy]$ ]]; then
  ufw allow 4310/tcp comment 'ACTUALLY Open Dots LAN access'
  if [[ "$enable_https" =~ ^[Yy]$ ]]; then
    ufw allow 443/tcp comment 'ACTUALLY Open Dots HTTPS'
  fi
  if ufw status | grep -q '^Status: active'; then
    if [[ "$enable_https" =~ ^[Yy]$ ]]; then
      echo "UFW now allows TCP 4310 (certificate download/redirect) and 443 (HTTPS) for ACTUALLY Open Dots."
    else
      echo "UFW now allows TCP 4310 for ACTUALLY Open Dots."
    fi
  else
    echo "The UFW rule was added, but UFW is inactive; the rule will apply only if you enable UFW later."
    echo "UFW was not enabled automatically, so existing remote-access rules are unchanged."
  fi
fi
echo
if [[ "$expose_lan" =~ ^[Yy]$ ]]; then
  echo "LAN access is enabled. Sign in with the ACTUALLY Open Dots password you set during installation."
  if [[ "$enable_https" =~ ^[Yy]$ ]]; then
    echo "Open https://${access_ip}/ from another device on your LAN."
  else
    echo "Open http://${access_ip}:4310 from another device on your LAN."
  fi
else
  if [[ "$enable_https" =~ ^[Yy]$ ]]; then
    echo "ACTUALLY Open Dots is installed locally. Open https://localhost/."
  else
    echo "ACTUALLY Open Dots is installed and running locally. Open http://localhost:4310."
  fi
fi
if [[ "$enable_https" =~ ^[Yy]$ ]]; then
  echo
  echo "To allow browser microphone access, trust this local CA on each device before opening the HTTPS address:"
  echo "  Download: http://${access_ip}:4310/opendots-local-ca.crt"
  echo "  SHA-256:  $(openssl x509 -noout -fingerprint -sha256 -in /etc/opendots/tls/opendots-local-ca.crt | cut -d= -f2)"
  echo "On Windows, open the downloaded certificate, choose Current User, and import it into Trusted Root Certification Authorities."
  echo "Then fully restart the browser. Keep the CA private key on this server; rerun this installer after the server IP changes."
fi
echo "Manage model connections and the Resident and Housekeeping roles in Settings → Models / Connections."
echo "Optional harnesses are installed from Settings → Harnesses; choose only the ones you want."
