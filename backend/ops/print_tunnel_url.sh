#!/usr/bin/env bash

if ! systemctl is-active --quiet waterstatus-quick-tunnel; then
  echo "waterstatus-quick-tunnel is not active" >&2
  exit 1
fi

sudo journalctl -u waterstatus-quick-tunnel -n 200 --no-pager | grep -o 'https://[^ ]*trycloudflare.com' | tail -n 1
