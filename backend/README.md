# Backend Ops (Pi, systemd, quick tunnel)

This setup keeps the API bound to `127.0.0.1:8000` and exposes it through a local Cloudflare quick tunnel service.
The quick-tunnel unit is intentionally anti-thrash (`Restart=on-failure`, delayed retries, and start-limit controls) to avoid repeated 1015/429 rate limits, but it now allows a few retries so one transient failure does not disable the tunnel for an hour.

The systemd units are tracked in:
- `backend/ops/systemd/waterstatus-api.service`
- `backend/ops/systemd/waterstatus-quick-tunnel.service`

## One-time cleanup (if old cloudflared unit exists)

```bash
sudo systemctl disable --now cloudflared || true
```

## Make helper script executable

```bash
chmod +x backend/ops/print_tunnel_url.sh
```

## Install units

```bash
sudo cp backend/ops/systemd/waterstatus-api.service /etc/systemd/system/waterstatus-api.service
sudo cp backend/ops/systemd/waterstatus-quick-tunnel.service /etc/systemd/system/waterstatus-quick-tunnel.service
sudo systemctl daemon-reload
sudo systemctl enable --now waterstatus-api
sudo systemctl enable --now waterstatus-quick-tunnel
```

## Check status/logs

```bash
sudo systemctl status waterstatus-api --no-pager
sudo systemctl status waterstatus-quick-tunnel --no-pager
sudo journalctl -u waterstatus-quick-tunnel -n 100 --no-pager
```

## Get current tunnel URL

```bash
bash backend/ops/print_tunnel_url.sh
```

Direct command (same extraction used by the helper script):

```bash
sudo journalctl -u waterstatus-quick-tunnel -n 200 --no-pager | grep -o 'https://[^ ]*trycloudflare.com' | tail -n 1
```

## Health checks after reboot

```bash
curl -sS http://127.0.0.1:8000/healthz
curl -sS "$(bash backend/ops/print_tunnel_url.sh)/healthz"
```

Both services should be active after reboot (`waterstatus-api`, `waterstatus-quick-tunnel`).

## When tunnel URL changes (committee demo maintenance)

- Run `bash backend/ops/print_tunnel_url.sh` to get the new `https://<...>.trycloudflare.com`
- In Render (frontend static site), update env var `VITE_API_BASE_URL` to that new URL
- `VITE_API_BASE` is accepted as a legacy alias by the frontend, but `VITE_API_BASE_URL` is the canonical name
- Trigger a redeploy (prefer “clear build cache and deploy” if available)

## If the quick tunnel URL itself returns 404

- Check for an existing Cloudflare config file in `~/.cloudflared/config.yml`, `~/.cloudflared/config.yaml`, `/etc/cloudflared/config.yml`, or `/etc/cloudflared/config.yaml`
- Cloudflare documents that TryCloudflare quick tunnels are not supported when a `config.yaml` file is present in the `.cloudflared` directory
- If you already have a named tunnel config for `api.water-status.shop`, temporarily rename that config file, restart `waterstatus-quick-tunnel`, and fetch the newly issued `trycloudflare.com` URL again
- Verify the new tunnel directly before updating Render:

```bash
curl -sS "$(bash backend/ops/print_tunnel_url.sh)/healthz"
curl -sS "$(bash backend/ops/print_tunnel_url.sh)/sensors" | head
```

## If quick tunnel is rate-limited (1015 / 429)

- Stop the tunnel service so it does not keep retrying aggressively:

```bash
sudo systemctl stop waterstatus-quick-tunnel
```

- Watch logs and restart later after cooldown:

```bash
sudo journalctl -u waterstatus-quick-tunnel -n 100 --no-pager
sudo systemctl start waterstatus-quick-tunnel
```

## Cloudflared binary path note

If tunnel service fails to start because `cloudflared` is not on the default systemd path, run:

```bash
command -v cloudflared
```

The tracked unit now uses `/usr/bin/env cloudflared` with an explicit `PATH`, but if your installed unit is older, update it and run:

```bash
sudo systemctl daemon-reload
sudo systemctl restart waterstatus-quick-tunnel
```

## Render Free keep-awake (Raspberry Pi cron)

This is an external workaround that runs on the Raspberry Pi user account, not inside Render.
It periodically pings the deployed Render backend health endpoint to reduce cold-start delays.

Current backend URL:

```bash
https://water-status-backend.onrender.com
```

### Cron entry (user `faiz`)

```cron
*/10 * * * * /usr/bin/curl -fsS --max-time 20 https://water-status-backend.onrender.com/healthz >/dev/null 2>&1
```

### Manual health test

```bash
curl -i https://water-status-backend.onrender.com/healthz
```

Expected: HTTP `200`.

### Verify cron is active

```bash
crontab -l
sudo systemctl status cron --no-pager
journalctl -u cron --since "30 minutes ago" --no-pager | grep faiz
```

### Remove the keep-awake job safely

```bash
crontab -e
```

Delete only the keep-awake cron line, save, then re-check with:

```bash
crontab -l
```

### Important limitation

This keep-awake method is suitable for hobby/public-demo use only on Render Free services.
It can reduce cold starts, but it may consume most of Render Free monthly instance hours (`750` hours/month) if the backend stays active continuously.
The production-grade always-on solution is to upgrade the Render backend service to a paid instance.
