#!/usr/bin/env python3
"""Guard the navigation and the redirect stubs against known regressions.

Run:  python tests/check-nav.py

Each check here corresponds to a bug that actually shipped:

  offsite redirects  Stubs used to send visitors to https://www.space4climate.org
                     from any host that was not localhost, so every one of them
                     threw people off a preview deployment onto the old site.

  crowded nav        At >=992px the nav is a three-column grid with minmax(0, ...)
                     tracks, so content wider than its track overlaps its
                     neighbours rather than pushing them aside. Adding long menu
                     items produced overlapping text.

  hidden switcher    The language switcher was placed inside .nav_btn_dekstop,
                     which is display:none below 992px, so phone users could not
                     change language at all. It belongs after that container.

  zero-width nav     .u-container is max-width: var(--container--main), and the
                     theme's own default for that variable is 0px. Every page
                     must override it in the page_code_base block, or its nav
                     container collapses to zero width and the logo, menu and
                     buttons render on top of one another.

  reset buttons      The theme resets padding on every button inside .u-body.
                     That is a class+element selector, so any single-class rule
                     of ours loses to it and the button renders with no padding.
"""
from __future__ import annotations

import pathlib
import re
import sys

SITE = pathlib.Path(__file__).resolve().parent.parent / "space4climate"

# Four fit comfortably beside the logo and the button row at 992px. More than
# this and the centre column starts colliding with its neighbours.
MAX_TOP_LEVEL_ITEMS = 4

MENU_LINK_RE = re.compile(r'class="nav_menu_link[^"]*"[^>]*>\s*<div class="nav_menu_text">([^<]*)</div>')
DROPDOWN_RE = re.compile(r'class="nav_menu_text">([^<]*)</div>\s*<div class="nav_dropdown_svg_desktop')


def real_pages():
    for path in sorted(SITE.rglob("*.html")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "site-support.js" in text:
            yield path, text


def stubs():
    for path in sorted(SITE.rglob("*.html")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "Redirecting" in text[:3000]:
            yield path, text


def main() -> int:
    failures: list[str] = []

    # 1. No stub may send a visitor to another origin.
    stub_count = 0
    for path, text in stubs():
        stub_count += 1
        rel = path.relative_to(SITE).as_posix()
        if "isLocal" in text:
            failures.append(f"{rel}: still switches on hostname instead of staying on this origin")
        for target in re.findall(r'window\.location\.replace\(\s*[\'"]([^\'"]+)', text):
            if "//" in target:
                failures.append(f"{rel}: redirects offsite to {target}")
        for href in re.findall(r'<a href="(https?://[^"]+)"', text):
            failures.append(f"{rel}: fallback link points offsite to {href}")

    # 2. The nav must stay narrow enough not to collide.
    page_count = 0
    switcher_pages = 0
    for path, text in real_pages():
        page_count += 1
        rel = path.relative_to(SITE).as_posix()
        try:
            nav = text[text.index('<div class="nav_menu_layout">') : text.index("</nav>")]
        except ValueError:
            failures.append(f"{rel}: no nav_menu_layout found")
            continue
        items = MENU_LINK_RE.findall(nav) + DROPDOWN_RE.findall(nav)
        if len(items) > MAX_TOP_LEVEL_ITEMS:
            failures.append(f"{rel}: {len(items)} top-level nav items ({', '.join(items)}) — max {MAX_TOP_LEVEL_ITEMS}")

        # 3. The switcher must sit after .nav_btn_dekstop, not inside it.
        if "s4c-lang-switch" not in text:
            failures.append(f"{rel}: no language switcher")
            continue
        switcher_pages += 1
        opening = text.index('<div class="nav_btn_dekstop">')
        closing = text.index('<button aria-label="Menu Open"', opening)
        if "s4c-lang-switch" in text[opening:closing].split("</div>")[0]:
            failures.append(f"{rel}: switcher is inside .nav_btn_dekstop, so it vanishes below 992px")
        if text.index("s4c-lang-switch") > closing:
            failures.append(f"{rel}: switcher sits after the menu button instead of before it")

    # 4. Every real page must set the container width variable.
    for path, text in real_pages():
        rel = path.relative_to(SITE).as_posix()
        if "--container--main" not in text:
            failures.append(f"{rel}: no --container--main, so .u-container collapses to zero width")

    # 5. Rules that style a <button> must outrank the theme's .u-body reset.
    perf = (SITE / "perf.css").read_text(encoding="utf-8")
    for selector in (".s4c-lang-btn {", ".s4c-lang-btn.is-active {"):
        if selector in perf and f".u-body {selector}" not in perf:
            failures.append(f"perf.css: '{selector.strip(' {{')}' loses to .u-body button and will lose its padding")

    print(f"redirect stubs checked : {stub_count}")
    print(f"real pages checked     : {page_count}")
    print(f"pages with a switcher  : {switcher_pages}")
    print(f"failures               : {len(failures)}")
    for failure in failures:
        print(f"  {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
