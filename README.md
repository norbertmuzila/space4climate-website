# Space4Climate website

A static site (exported from Webflow, then hand-edited) plus a small set of
serverless functions for scheduling. There is no build step and no package
manager: the HTML in `space4climate/` is served as-is.

## Running it locally

```bash
cd space4climate
python dev-server.py          # http://127.0.0.1:8080
```

`dev-server.py` serves the static files **and** mirrors every `/api` endpoint,
so the scheduling features work offline. It needs nothing but Python 3.11+.

## Layout

| Path | What it is |
| --- | --- |
| `space4climate/` | The site root — this is `outputDirectory` in `vercel.json` |
| `space4climate/assets/logo-mark.png` | The brand emblem, cropped from `space4climate_logo.png` at the repo root |
| `space4climate/perf.css` | Site-wide overrides layered on the Webflow stylesheet |
| `space4climate/orbit.css` | Dark app theme shared by the scheduling pages |
| `space4climate/scheduling.css` | Styles specific to the volunteer and session pages |
| `space4climate/i18n.js` | English/German switching |
| `space4climate/scheduling.js` | Timezone maths, the weekly grid, window validation |
| `api/` | Vercel serverless functions |
| `tests/` | Checks you can run without installing anything |

Pages come in two kinds: 46 real pages, each carrying its own copy of the
navigation and footer, and 56 redirect stubs that bounce to the canonical URL.

## Scheduling

**Volunteers** register at `/volunteers.html`. Availability is a recurring
weekly pattern, stored as `weekday-hour` slots in the volunteer's own timezone
— `2-14` is Tuesday 14:00. Submitting returns a private edit link; that link is
the only way back into a registration.

**Teachers** request a workshop at `/request-session.html` by choosing a start
date and time, an end date and time, and a timezone. The end must fall after
the start, and when both land on the same date that means the end time must be
later than the start time. That rule is enforced in the browser as the fields
change and again in the API, so the endpoint cannot be handed an impossible
window directly.

While the window is valid the page checks it against the volunteer roster and
reports how many facilitators are free. The browser only ever receives
timezones and availability — never names or email addresses.

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/volunteers` | Service status and roster size |
| `GET /api/volunteers?roster=1` | Anonymised availability, for matching |
| `GET,PUT /api/volunteers?id=&token=` | Read or update one registration |
| `POST /api/volunteers` | Register; returns an edit token |
| `GET /api/sessions?id=&token=` | Read one request |
| `POST /api/sessions` | File a session request |
| `GET,POST,PUT /api/orbit` | The Orbit shared-availability boards |

### Storage, and a deployment requirement

`/api/orbit` holds anonymous availability grids and falls back to JSONBlob, a
public third-party store, when nothing else is configured.

`/api/volunteers` and `/api/sessions` hold **personal data**, so they never use
that fallback. They require Vercel KV and refuse writes with
`storage_unconfigured` (HTTP 503) when it is missing, rather than dropping the
data or exposing it publicly. Set both of these in the Vercel project before
the forms will work in production:

```
KV_REST_API_URL
KV_REST_API_TOKEN
```

Locally, `dev-server.py` writes JSON files under `space4climate/.s4c-data/`
instead, which `.gitignore` excludes.

## Languages

A switcher in the navigation toggles English and German and remembers the
choice. German covers the navigation, footer and every label and error in the
scheduling forms. Long-form article and legal copy stays in English on purpose:
unreviewed machine German on a schools site would read worse than none.

## Checks

```bash
node tests/scheduling.test.js   # timezone maths, DST, window rules, matching
python tests/check-links.py     # every internal link and asset resolves
python tests/check-i18n.py      # each German entry matches real text on a page
```

`check-i18n.py` matters because the chrome is translated by exact text match:
an entry whose English side is not on the page silently does nothing.

## Windows note

Thirteen pagination files once carried a literal `?` in their names, a wget
artefact that NTFS cannot represent — `git clone` failed at checkout on
Windows. They are now named with `_`, and the links that pointed at them were
updated to match.
