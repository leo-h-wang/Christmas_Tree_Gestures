#!/bin/sh
# Regenerate the photo manifest and serve the page on localhost
# (the camera API only works on a secure origin such as localhost).
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8000}"
URL="http://localhost:$PORT"

python3 gen_manifest.py
echo "打开 $URL  （Ctrl+C 停止）"
(sleep 1 && open "$URL") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
