# Backend Ops (Pi, systemd, quick tunnel)

This setup keeps the API bound to `127.0.0.1:8000` and exposes it through a local Cloudflare quick tunnel service.

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
journalctl -u waterstatus-quick-tunnel -n 100 --no-pager
```

## Get current tunnel URL

```bash
bash backend/ops/print_tunnel_url.sh
```

## Health checks after reboot

```bash
curl -sS http://127.0.0.1:8000/healthz
curl -sS "$(bash backend/ops/print_tunnel_url.sh)/healthz"
```

Both services should be active after reboot (`waterstatus-api`, `waterstatus-quick-tunnel`).

## When tunnel URL changes (committee demo maintenance)

- Run `bash backend/ops/print_tunnel_url.sh` to get the new `https://<...>.trycloudflare.com`
- In Render (frontend static site), update env var `VITE_API_BASE` to that new URL
- Trigger a redeploy (prefer “clear build cache and deploy” if available)

## Cloudflared binary path note

If tunnel service fails to start because `cloudflared` is not at `/usr/bin/cloudflared`, run:

```bash
command -v cloudflared
```

Then update `ExecStart=` in `/etc/systemd/system/waterstatus-quick-tunnel.service` to the discovered path and run:

```bash
sudo systemctl daemon-reload
sudo systemctl restart waterstatus-quick-tunnel
```
