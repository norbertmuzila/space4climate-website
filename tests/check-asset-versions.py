#!/usr/bin/env python3
"""Keep the ?v= markers on local CSS and JS in step with their contents.

Run:        python tests/check-asset-versions.py
Re-stamp:   python tests/check-asset-versions.py --fix

Those assets are served with a one-hour cache, so a change that reuses the old
marker reaches nobody who already has the file — the stylesheet ships, the
browser keeps the stale copy, and the page looks broken for an hour with no
sign of why. Deriving the marker from the file's own hash makes that
impossible: change the file and the URL changes with it.
"""
from __future__ import annotations

import hashlib
import pathlib
import re
import sys

SITE = pathlib.Path(__file__).resolve().parent.parent / "space4climate"

# Local assets referenced with a ?v= marker.
ASSETS = [
    "perf.css",
    "orbit.css",
    "scheduling.css",
    "site-support.js",
    "i18n.js",
    "scheduling.js",
    "login.js",
    "volunteers.js",
    "request-session.js",
]


def digest(name: str) -> str:
    return hashlib.sha256((SITE / name).read_bytes()).hexdigest()[:8]


def reference_re(name: str) -> re.Pattern[str]:
    # Matches href/src="<any ../ prefix><name>?v=<marker>"
    return re.compile(r'((?:\.\./)*' + re.escape(name) + r')\?v=([A-Za-z0-9]+)')


def main() -> int:
    fix = "--fix" in sys.argv
    wanted = {name: digest(name) for name in ASSETS if (SITE / name).exists()}

    stale: list[str] = []
    rewritten = 0
    for path in sorted(SITE.rglob("*.html")):
        text = path.read_text(encoding="utf-8")
        original = text
        for name, want in wanted.items():
            pattern = reference_re(name)
            for match in pattern.finditer(text):
                if match.group(2) != want:
                    stale.append(f"{path.relative_to(SITE).as_posix()}: {name}?v={match.group(2)} should be ?v={want}")
            if fix:
                text = pattern.sub(lambda m, w=want: f"{m.group(1)}?v={w}", text)
        if fix and text != original:
            path.write_text(text, encoding="utf-8")
            rewritten += 1

    print(f"assets tracked : {len(wanted)}")
    for name, want in sorted(wanted.items()):
        print(f"  {name:22} v={want}")

    if fix:
        print(f"\npages re-stamped : {rewritten}")
        return 0

    print(f"\nstale references : {len(stale)}")
    for entry in stale[:20]:
        print(f"  {entry}")
    if len(stale) > 20:
        print(f"  ... and {len(stale) - 20} more")
    if stale:
        print("\nRun: python tests/check-asset-versions.py --fix")
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main())
