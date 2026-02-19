#!/usr/bin/env bash
journalctl -u waterstatus-quick-tunnel -n 200 --no-pager | grep -o 'https://[^ ]*trycloudflare.com' | tail -n 1
