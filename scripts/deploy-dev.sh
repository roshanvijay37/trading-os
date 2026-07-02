#!/usr/bin/env bash
# Deploy the dev preview on the Lightsail box (run as ubuntu on api.roshanvijay.com):
#
#   curl -fsSL https://raw.githubusercontent.com/roshanvijay37/trading-os/dev/scripts/deploy-dev.sh | bash
#
# What it does:
#   1. Pulls the prebuilt static bundle (dev-dist branch, produced by the
#      "Build dev preview" GitHub Action on every push to dev) into
#      /var/www/trading-os-preview/dev. The box has 416MB RAM — never build here.
#   2. Adds an nginx `location /dev/` to the api.roshanvijay.com HTTPS server
#      (idempotent; backs up the config first), tests and reloads nginx.
#   3. Verifies https://api.roshanvijay.com/dev/ responds.
#
# Production (~/trading-os, pm2 "trading-os", GitHub Pages) is not touched.
# Subsequent deploys only need step 1 + nothing else: just re-run this script.
set -euo pipefail

echo "== site dir =="
sudo mkdir -p /var/www/trading-os-preview
sudo chown ubuntu:ubuntu /var/www/trading-os-preview
if [ -d /var/www/trading-os-preview/dev/.git ]; then
  git -C /var/www/trading-os-preview/dev fetch --depth 1 origin dev-dist
  git -C /var/www/trading-os-preview/dev reset --hard origin/dev-dist
else
  git clone --branch dev-dist --depth 1 https://github.com/roshanvijay37/trading-os.git /var/www/trading-os-preview/dev
fi
echo "-- artifact --"
ls /var/www/trading-os-preview/dev

echo "== nginx location /dev/ =="
CONF=/etc/nginx/sites-available/tradingos
if sudo grep -q "location /dev/" "$CONF"; then
  echo "location /dev/ already present"
else
  sudo cp "$CONF" "$CONF.bak.$(date +%Y%m%d%H%M%S)"
  sudo python3 - "$CONF" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p).read()
m = re.search(r"\n([ \t]*)location\s+/\s*\{", s)
assert m, "location / block not found"
ind = m.group(1)
block = (
    f"\n{ind}# Dev preview: dev-branch frontend build (published to the dev-dist branch)\n"
    f"{ind}location /dev/ {{\n"
    f"{ind}    root /var/www/trading-os-preview;\n"
    f"{ind}    try_files $uri $uri/ /dev/index.html;\n"
    f"{ind}}}\n"
)
s = s[: m.start()] + block + s[m.start():]
open(p, "w").write(s)
print("inserted location /dev/ into", p)
PYEOF
fi

echo "== nginx test + reload =="
sudo nginx -t
sudo systemctl reload nginx

echo "== verify =="
curl -sI https://api.roshanvijay.com/dev/ | head -5
echo "DEV DEPLOY OK -> https://api.roshanvijay.com/dev/"
