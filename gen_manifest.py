#!/usr/bin/env python3
"""Scan photos/ for images and write photos/manifest.json for the web page."""
import json
from pathlib import Path

PHOTO_DIR = Path(__file__).resolve().parent / "photos"
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


def main():
    PHOTO_DIR.mkdir(exist_ok=True)
    names = sorted(
        p.name
        for p in PHOTO_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in EXTS and not p.name.startswith(".")
    )
    manifest = PHOTO_DIR / "manifest.json"
    manifest.write_text(json.dumps(names, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"找到 {len(names)} 张照片，已写入 {manifest}")


if __name__ == "__main__":
    main()
