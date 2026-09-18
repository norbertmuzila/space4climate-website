#!/usr/bin/env python3
"""Check the German chrome dictionary against the text actually on the pages.

i18n.js translates the navigation and footer by exact text match, so an entry
whose English side does not appear verbatim in a real text node silently does
nothing. This compares the dictionary with the text nodes inside the scopes
i18n.js walks, and reports entries that never match.

Run:  python tests/check-i18n.py
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "space4climate"
I18N = SITE / "i18n.js"

# The scopes i18n.js applies the exact-text pass to. The nav runs from its
# opening div to the script block that follows it, which covers the menu links,
# the dropdowns and the button row — the same ground the .nav_component
# selector covers at runtime.
SCOPE_RE = re.compile(
    r'<div class="nav_component">.*?(?=<div class="u-embed-js)'
    r'|<footer class="footer_wrap">.*?</footer>',
    re.S,
)
TAG_RE = re.compile(r"<[^>]+>")
ATTR_RE = re.compile(r'\b(?:placeholder|aria-label|title|alt|data-wait|value)="([^"]*)"')


def dictionary() -> dict[str, str]:
    """Pull the CHROME_DE table out of i18n.js without running a browser."""
    source = I18N.read_text(encoding="utf-8")
    start = source.index("var CHROME_DE = {")
    body = source[source.index("{", start) : source.index("\n  };", start) + 4]
    # The table is plain string:string pairs, so JSON parses it once the
    # trailing brace is trimmed and the explanatory // comments are dropped.
    body = re.sub(r"^\s*//.*$", "", body, flags=re.M)

    def no_duplicates(pairs):
        # JSON and JavaScript both keep the last of a repeated key silently,
        # which hides an entry that was edited in two places.
        seen: dict[str, str] = {}
        for key, value in pairs:
            if key in seen:
                raise SystemExit(f"duplicate dictionary key in i18n.js: {key!r}")
            seen[key] = value
        return seen

    return json.loads(body.rstrip().rstrip(";").replace("\n  };", "}"), object_pairs_hook=no_duplicates)


def page_strings() -> set[str]:
    found: set[str] = set()
    for path in SITE.rglob("*.html"):
        text = path.read_text(encoding="utf-8", errors="replace")
        for scope in SCOPE_RE.findall(text):
            for attr in ATTR_RE.findall(scope):
                found.add(html.unescape(attr).strip())
            for chunk in TAG_RE.sub("\x00", scope).split("\x00"):
                value = html.unescape(chunk).strip()
                if value:
                    found.add(value)
    return found


def main() -> int:
    table = dictionary()
    on_page = page_strings()
    unmatched = sorted(k for k in table if k not in on_page)

    print(f"dictionary entries : {len(table)}")
    print(f"distinct chrome strings on the site : {len(on_page)}")
    print(f"entries that never match : {len(unmatched)}")
    if unmatched:
        print("\nTHESE WILL NEVER TRANSLATE (no exact text node matches)")
        for key in unmatched:
            near = [s for s in on_page if key.lower().rstrip(".") in s.lower()]
            hint = f"   closest on page: {near[0]!r}" if near else ""
            print(f"  {key!r}{hint}")
    return 1 if unmatched else 0


if __name__ == "__main__":
    sys.exit(main())
