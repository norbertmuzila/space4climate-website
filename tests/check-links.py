#!/usr/bin/env python3
"""Check every internal link and asset reference on the site resolves.

Run from anywhere:  python tests/check-links.py

Reports three things:
  broken   an internal href/src pointing at a file that does not exist
  dead     an anchor with no destination (href="#" or empty), which looks
           clickable but does nothing
  external hosts linked to, for a quick eyeball of third-party dependencies
"""
from __future__ import annotations

import collections
import html
import pathlib
import posixpath
import re
import sys
import urllib.parse

SITE = pathlib.Path(__file__).resolve().parent.parent / "space4climate"

ATTR_RE = re.compile(r'\b(?:href|src)\s*=\s*"([^"]*)"', re.I)
SRCSET_RE = re.compile(r'\bsrcset\s*=\s*"([^"]*)"', re.I)
# Inline CSS and JS are full of strings that look like attributes; strip them
# before scanning so a selector such as a[href="#"] is not read as a link.
BLOCK_RE = re.compile(r"<(style|script)\b[^>]*>.*?</\1>", re.I | re.S)
SKIP_SCHEMES = ("http://", "https://", "mailto:", "tel:", "data:", "javascript:", "//")


def page_files():
    return sorted(p for p in SITE.rglob("*.html"))


def existing_paths() -> set[str]:
    """Every file under the site root, as a posix path relative to it.

    Resolved up front so link checking is set membership rather than a
    filesystem call per reference — on Windows that is the difference between
    a couple of minutes and a couple of seconds.
    """
    return {p.relative_to(SITE).as_posix() for p in SITE.rglob("*") if p.is_file()}


def check() -> int:
    broken: list[tuple[str, str]] = []
    dead: list[tuple[str, str]] = []
    external = collections.Counter()
    checked = 0
    pages = page_files()
    on_disk = existing_paths()

    for path in pages:
        rel = path.relative_to(SITE).as_posix()
        text = BLOCK_RE.sub("", path.read_text(encoding="utf-8", errors="replace"))

        refs = list(ATTR_RE.findall(text))
        for srcset in SRCSET_RE.findall(text):
            for candidate in srcset.split(","):
                url = candidate.strip().split(" ")[0]
                if url:
                    refs.append(url)

        for raw in refs:
            ref = html.unescape(raw).strip()
            if not ref:
                continue
            if ref.startswith(SKIP_SCHEMES):
                host = urllib.parse.urlparse(ref if "//" in ref[:8] else "https:" + ref).netloc
                if host:
                    external[host] += 1
                continue
            if ref.startswith("#"):
                if ref == "#":
                    dead.append((rel, ref))
                continue

            target = urllib.parse.urlparse(ref)
            if not target.path:
                continue
            checked += 1
            wanted = urllib.parse.unquote(target.path)
            base = path.parent.relative_to(SITE).as_posix()
            joined = posixpath.normpath(posixpath.join(base, wanted)) if base != "." else posixpath.normpath(wanted)
            if joined not in on_disk:
                broken.append((rel, ref))

    print(f"pages scanned : {len(pages)}")
    print(f"internal refs : {checked}")
    print(f"broken        : {len(broken)}")
    print(f"dead anchors  : {len(dead)}")

    if broken:
        print("\nBROKEN INTERNAL REFERENCES")
        for page, ref in sorted(set(broken)):
            print(f"  {page}  ->  {ref}")

    if dead:
        counts = collections.Counter(page for page, _ in dead)
        print("\nANCHORS THAT GO NOWHERE (href=\"#\")")
        for page, count in sorted(counts.items()):
            print(f"  {page}: {count}")

    print("\nEXTERNAL HOSTS")
    for host, count in external.most_common():
        print(f"  {count:>5}  {host}")

    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(check())
