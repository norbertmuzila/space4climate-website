#!/usr/bin/env python3
"""Local static server plus the /api endpoints: Orbit, volunteers, sessions.

This mirrors what the Vercel functions in ../api do, so the whole site can be
worked on offline. The Vercel side keeps volunteer and session records in KV
because they hold personal data; locally they are plain JSON files under
.s4c-data/, which .gitignore keeps out of the repository.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request
import zoneinfo
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / ".orbit-data"
PEOPLE_DIR = ROOT / ".s4c-data"
MAX_BYTES = 256 * 1024
SLOT_KEY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}$")
WEEK_SLOT_RE = re.compile(r"^[0-6]-([01]\d|2[0-3])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
LANGS = ("en", "de")
DATA_DIR.mkdir(exist_ok=True)
for _kind in ("volunteers", "sessions", "users", "logins"):
    (PEOPLE_DIR / _kind).mkdir(parents=True, exist_ok=True)


def new_id() -> str:
    return "ob_" + secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:12]


def board_path(board_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "", board_id)[:80]
    return DATA_DIR / f"{safe}.json"


def normalise_board(raw, fallback_id: str):
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or "").strip()[:120]
    start_date = raw.get("startDate") if isinstance(raw.get("startDate"), str) else None
    end_date = raw.get("endDate") if isinstance(raw.get("endDate"), str) else None
    try:
        start_hour = int(raw.get("startHour"))
        end_hour = int(raw.get("endHour"))
    except (TypeError, ValueError):
        return None
    if not title or not start_date or not end_date:
        return None
    if start_date > end_date or start_hour < 0 or end_hour > 24 or start_hour >= end_hour:
        return None
    raw_id = str(raw.get("id") or "").strip()
    board_id = fallback_id if (not raw_id or raw_id == "pending") else raw_id
    return {
        "id": board_id,
        "title": title,
        "startDate": start_date,
        "endDate": end_date,
        "startHour": start_hour,
        "endHour": end_hour,
        "timezone": raw.get("timezone") if isinstance(raw.get("timezone"), str) else "",
        "createdAt": int(raw.get("createdAt") or 0) or int(__import__("time").time() * 1000),
    }


def normalise_document(raw, fallback_id: str):
    if not isinstance(raw, dict):
        return None
    board = normalise_board(raw.get("board") if isinstance(raw.get("board"), dict) else raw, fallback_id)
    if not board:
        return None
    participants = {}
    incoming = raw.get("participants") if isinstance(raw.get("participants"), dict) else {}
    for key, value in incoming.items():
        if not isinstance(value, dict):
            continue
        pid = str(value.get("id") or key).strip()
        name = str(value.get("name") or "").strip()[:40]
        if not pid or not name:
            continue
        slots = value.get("slots") if isinstance(value.get("slots"), list) else []
        slots = sorted({s for s in slots if isinstance(s, str) and SLOT_KEY_RE.match(s)})
        participants[pid] = {"id": pid, "name": name, "slots": slots}
        if value.get("mergedAt"):
            participants[pid]["mergedAt"] = value.get("mergedAt")
    booking = None
    raw_booking = raw.get("booking")
    if isinstance(raw_booking, dict):
        slot = raw_booking.get("slot") if isinstance(raw_booking.get("slot"), str) else ""
        bid = str(raw_booking.get("id") or "").strip()[:32]
        if SLOT_KEY_RE.match(slot or "") and bid:
            booking = {
                "slot": slot,
                "id": bid,
                "bookedAt": int(raw_booking.get("bookedAt") or 0) or int(__import__("time").time() * 1000),
                "name": str(raw_booking.get("name") or "").strip()[:40],
            }
    return {
        "board": board,
        "participants": participants,
        "booking": booking,
        "updatedAt": int(raw.get("updatedAt") or 0) or int(__import__("time").time() * 1000),
    }


def now_ms() -> int:
    return int(time.time() * 1000)


def clean_text(value, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


try:
    HAS_TZDB = bool(zoneinfo.available_timezones())
except Exception:
    HAS_TZDB = False

TZ_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_-]+){1,2}$")


def clean_timezone(value) -> str:
    """Accept a timezone only if it resolves, or looks well-formed.

    Bare Windows ships no IANA database, so zoneinfo resolves nothing there and
    strict checking would reject every timezone during local development. Where
    a database exists (macOS, Linux, and the Vercel runtime) the name must
    genuinely resolve; otherwise fall back to a shape check so the dev server
    stays usable without adding a tzdata dependency. UTC is always allowed.
    """
    tz = clean_text(value, 64)
    if not tz:
        return ""
    if tz == "UTC":
        return tz
    if HAS_TZDB:
        try:
            zoneinfo.ZoneInfo(tz)
        except Exception:
            return ""
        return tz
    return tz if TZ_NAME_RE.match(tz) else ""


def clean_week_slots(value) -> list[str]:
    if not isinstance(value, list):
        return []
    seen = {s for s in value if isinstance(s, str) and WEEK_SLOT_RE.match(s)}
    return sorted(seen, key=lambda s: (int(s.split("-")[0]), int(s.split("-")[1])))


def minutes_of(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def window_error(start_date: str, start_time: str, end_date: str, end_time: str) -> str:
    """A session must end after it starts; on one date, later in the day."""
    if not DATE_RE.match(start_date) or not DATE_RE.match(end_date):
        return "invalid_date"
    if not TIME_RE.match(start_time) or not TIME_RE.match(end_time):
        return "invalid_time"
    if end_date < start_date:
        return "end_before_start"
    if end_date == start_date and minutes_of(end_time) <= minutes_of(start_time):
        return "end_time_not_after_start"
    return ""


def validate_volunteer(raw):
    if not isinstance(raw, dict):
        return None, "invalid_body"
    name = clean_text(raw.get("name"), 80)
    email = clean_text(raw.get("email"), 120).lower()
    timezone = clean_timezone(raw.get("timezone"))
    slots = clean_week_slots(raw.get("slots"))
    if not name:
        return None, "missing_name"
    if not EMAIL_RE.match(email):
        return None, "invalid_email"
    if not timezone:
        return None, "invalid_timezone"
    if not slots:
        return None, "no_availability"
    languages = [lang for lang in LANGS if lang in (raw.get("languages") or [])]
    return {
        "name": name,
        "email": email,
        "timezone": timezone,
        "slots": slots,
        "languages": languages,
        "organisation": clean_text(raw.get("organisation"), 120),
        "notes": clean_text(raw.get("notes"), 600),
    }, ""


def validate_session(raw):
    if not isinstance(raw, dict):
        return None, "invalid_body"
    contact_name = clean_text(raw.get("contactName"), 80)
    email = clean_text(raw.get("email"), 120).lower()
    school = clean_text(raw.get("school"), 120)
    timezone = clean_timezone(raw.get("timezone"))
    start_date = clean_text(raw.get("startDate"), 10)
    start_time = clean_text(raw.get("startTime"), 5)
    end_date = clean_text(raw.get("endDate"), 10)
    end_time = clean_text(raw.get("endTime"), 5)
    if not contact_name:
        return None, "missing_name"
    if not EMAIL_RE.match(email):
        return None, "invalid_email"
    if not school:
        return None, "missing_school"
    if not timezone:
        return None, "invalid_timezone"
    issue = window_error(start_date, start_time, end_date, end_time)
    if issue:
        return None, issue
    try:
        students = int(raw.get("students"))
        students = students if 0 < students <= 2000 else None
    except (TypeError, ValueError):
        students = None
    language = raw.get("language") if raw.get("language") in LANGS else "en"
    return {
        "contactName": contact_name,
        "email": email,
        "school": school,
        "timezone": timezone,
        "startDate": start_date,
        "startTime": start_time,
        "endDate": end_date,
        "endTime": end_time,
        "students": students,
        "ageGroup": clean_text(raw.get("ageGroup"), 40),
        "language": language,
        "notes": clean_text(raw.get("notes"), 800),
    }, ""


SESSION_COOKIE = "s4c_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,30}$")
SCRYPT = {"n": 16384, "r": 8, "p": 1, "dklen": 64}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, **SCRYPT)
    return "scrypt${n}${r}${p}${salt}${key}".format(
        salt=base64.b64encode(salt).decode(),
        key=base64.b64encode(key).decode(),
        **SCRYPT,
    )


def password_matches(password: str, stored) -> bool:
    if not isinstance(stored, str):
        return False
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    _, n, r, p, salt_b64, key_b64 = parts
    expected = base64.b64decode(key_b64)
    actual = hashlib.scrypt(
        password.encode("utf-8"),
        salt=base64.b64decode(salt_b64),
        n=int(n),
        r=int(r),
        p=int(p),
        dklen=len(expected),
    )
    return hmac.compare_digest(actual, expected)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def find_user(predicate):
    for doc in all_records("users"):
        if predicate(doc):
            return doc
    return None


def find_by_identifier(identifier: str):
    """Accept either a username or an email address, as the login form does."""
    value = (identifier or "").strip()
    if not value:
        return None
    if "@" in value:
        wanted = value.lower()
        return find_user(lambda d: (d.get("email") or "").lower() == wanted)
    wanted = value.lower()
    return find_user(lambda d: (d.get("username") or "").lower() == wanted)


def derive_username(email: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9._-]", "", email.split("@")[0])[:24] or "member"
    if len(base) < 3:
        base += "user"
    if not find_user(lambda d: (d.get("username") or "").lower() == base.lower()):
        return base
    while True:
        candidate = f"{base}{secrets.randbelow(9000) + 1000}"
        if not find_user(lambda d: (d.get("username") or "").lower() == candidate.lower()):
            return candidate


def public_user(user):
    return {
        "id": user.get("id"),
        "name": user.get("name", ""),
        "username": user.get("username", ""),
        "email": user.get("email", ""),
        "picture": user.get("picture", ""),
        "provider": user.get("provider", "password"),
        "createdAt": user.get("createdAt"),
    }


def verify_google_token_dev(credential: str):
    """Verify a Google ID token via Google's tokeninfo endpoint.

    The Vercel function checks the RS256 signature against Google's published
    keys itself. Doing the same here would mean a crypto dependency the dev
    server does not otherwise need, so locally we ask Google to validate the
    token instead. Both paths still check audience, issuer and expiry.
    """
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise ValueError("google_not_configured")
    url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(credential or "")
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        raise ValueError("google_bad_token")
    if payload.get("aud") != client_id:
        raise ValueError("google_bad_token")
    if payload.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("google_bad_token")
    if int(payload.get("exp", 0)) < time.time():
        raise ValueError("google_bad_token")
    if str(payload.get("email_verified")).lower() != "true":
        raise ValueError("google_email_unverified")
    if not payload.get("email"):
        raise ValueError("google_bad_token")
    return payload


def record_path(kind: str, record_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "", record_id)[:80]
    return PEOPLE_DIR / kind / f"{safe}.json"


def read_record(kind: str, record_id: str):
    path = record_path(kind, record_id)
    if not record_id or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_record(kind: str, record_id: str, doc) -> None:
    record_path(kind, record_id).write_text(json.dumps(doc, indent=2), encoding="utf-8")


def all_records(kind: str):
    docs = []
    for path in sorted((PEOPLE_DIR / kind).glob("*.json")):
        try:
            docs.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            continue
    return docs


def without_token(doc):
    return {k: v for k, v in doc.items() if k != "token"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def route(self, parsed):
        """Map an /api path to its handler, or None for static files."""
        return {
            "/api/orbit": self.handle_orbit,
            "/api/volunteers": self.handle_volunteers,
            "/api/sessions": self.handle_sessions,
            "/api/auth": self.handle_auth,
        }.get(parsed.path.rstrip("/"))

    def do_OPTIONS(self):
        parsed = urllib.parse.urlparse(self.path)
        if self.route(parsed):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        handler = self.route(parsed)
        if handler:
            return handler("GET", parsed)
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        handler = self.route(parsed)
        if handler:
            return handler("POST", parsed)
        self.send_error(404)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        handler = self.route(parsed)
        if handler:
            return handler("PUT", parsed)
        self.send_error(404)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BYTES:
            raise ValueError("payload too large")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_orbit(self, method, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        board_id = (query.get("id") or [None])[0]
        try:
            if method == "GET" and not board_id:
                files = list(DATA_DIR.glob("*.json"))
                return self.send_json(200, {"ok": True, "service": "orbit", "boards": len(files)})
            if method == "GET":
                path = board_path(board_id)
                if not path.exists():
                    return self.send_json(404, {"error": "not found"})
                data = json.loads(path.read_text(encoding="utf-8"))
                return self.send_json(200, data)
            if method == "POST":
                incoming = self.read_json()
                preferred = ""
                if isinstance(incoming.get("board"), dict):
                    preferred = str(incoming["board"].get("id") or "")
                preferred = preferred or incoming.get("id") or new_id()
                doc = normalise_document(incoming, preferred)
                if not doc:
                    return self.send_json(400, {"error": "invalid board"})
                stored_id = doc["board"]["id"] or new_id()
                doc["board"]["id"] = stored_id
                board_path(stored_id).write_text(json.dumps(doc), encoding="utf-8")
                return self.send_json(201, {"id": stored_id, **doc})
            if method == "PUT":
                if not board_id:
                    return self.send_json(400, {"error": "missing id"})
                incoming = self.read_json()
                doc = normalise_document(incoming, board_id)
                if not doc:
                    return self.send_json(400, {"error": "invalid board"})
                doc["board"]["id"] = board_id
                board_path(board_id).write_text(json.dumps(doc), encoding="utf-8")
                return self.send_json(200, {"ok": True, **doc})
            return self.send_json(405, {"error": "method not allowed"})
        except Exception as err:
            return self.send_json(500, {"error": str(err)})


    def handle_volunteers(self, method, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        record_id = (query.get("id") or [""])[0]
        token = (query.get("token") or [""])[0]
        try:
            if method == "GET" and query.get("roster") == ["1"]:
                roster = [
                    {
                        "timezone": doc.get("timezone", ""),
                        "slots": doc.get("slots", []),
                        "languages": doc.get("languages", []),
                    }
                    for doc in all_records("volunteers")
                ]
                return self.send_json(200, {"ok": True, "roster": roster})
            if method == "GET" and not record_id:
                return self.send_json(
                    200,
                    {"ok": True, "service": "volunteers", "count": len(all_records("volunteers"))},
                )
            if method == "GET":
                doc = read_record("volunteers", record_id)
                if not doc:
                    return self.send_json(404, {"error": "not_found"})
                if not token or token != doc.get("token"):
                    return self.send_json(403, {"error": "bad_token"})
                return self.send_json(200, {"ok": True, "volunteer": without_token(doc)})
            if method == "POST":
                value, error = validate_volunteer(self.read_json())
                if error:
                    return self.send_json(400, {"error": error})
                doc = {
                    "id": "vl_" + secrets.token_hex(6),
                    "token": "tk_" + secrets.token_hex(6),
                    **value,
                    "createdAt": now_ms(),
                    "updatedAt": now_ms(),
                }
                write_record("volunteers", doc["id"], doc)
                return self.send_json(
                    201,
                    {"ok": True, "id": doc["id"], "token": doc["token"], "volunteer": without_token(doc)},
                )
            if method == "PUT":
                if not record_id:
                    return self.send_json(400, {"error": "missing_id"})
                existing = read_record("volunteers", record_id)
                if not existing:
                    return self.send_json(404, {"error": "not_found"})
                if not token or token != existing.get("token"):
                    return self.send_json(403, {"error": "bad_token"})
                value, error = validate_volunteer(self.read_json())
                if error:
                    return self.send_json(400, {"error": error})
                doc = {**existing, **value, "updatedAt": now_ms()}
                write_record("volunteers", record_id, doc)
                return self.send_json(200, {"ok": True, "volunteer": without_token(doc)})
            return self.send_json(405, {"error": "method_not_allowed"})
        except Exception as err:
            return self.send_json(500, {"error": "server_error", "message": str(err)})

    def send_json_cookie(self, status, payload, cookie):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def session_token(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == SESSION_COOKIE:
                return urllib.parse.unquote(value)
        return ""

    def start_session(self, user_id):
        token = secrets.token_urlsafe(32)
        write_record("logins", token_hash(token), {"userId": user_id, "createdAt": now_ms()})
        # No Secure flag here: the dev server is plain http on localhost.
        return (
            f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_SECONDS}; HttpOnly; SameSite=Lax"
        )

    def current_user(self):
        token = self.session_token()
        if not token:
            return None
        session = read_record("logins", token_hash(token))
        if not session or not session.get("userId"):
            return None
        return read_record("users", session["userId"])

    def handle_auth(self, method, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        action = (query.get("action") or [""])[0]
        client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
        try:
            if action == "config":
                return self.send_json(
                    200,
                    {
                        "ok": True,
                        "googleClientId": client_id,
                        # The dev server always has somewhere to write, so
                        # password accounts work locally with no setup.
                        "passwordAccounts": True,
                        "googleSignIn": bool(client_id),
                    },
                )

            if action == "me":
                user = self.current_user()
                return self.send_json(200, {"ok": True, "user": public_user(user) if user else None})

            if method != "POST":
                return self.send_json(405, {"error": "method_not_allowed"})

            if action == "logout":
                token = self.session_token()
                if token:
                    path = record_path("logins", token_hash(token))
                    if path.exists():
                        path.unlink()
                return self.send_json_cookie(
                    200, {"ok": True}, f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
                )

            if action == "signup":
                body = self.read_json()
                name = clean_text(body.get("name"), 80)
                email = clean_text(body.get("email"), 120).lower()
                username = clean_text(body.get("username"), 30)
                password = body.get("password") or ""
                if not name:
                    return self.send_json(400, {"error": "missing_name"})
                if not EMAIL_RE.match(email):
                    return self.send_json(400, {"error": "invalid_email"})
                if username and not USERNAME_RE.match(username):
                    return self.send_json(400, {"error": "invalid_username"})
                if len(password) < 8:
                    return self.send_json(400, {"error": "weak_password"})
                if find_user(lambda d: (d.get("email") or "").lower() == email):
                    return self.send_json(409, {"error": "email_taken"})
                if username and find_user(
                    lambda d: (d.get("username") or "").lower() == username.lower()
                ):
                    return self.send_json(409, {"error": "username_taken"})
                user = {
                    "id": "u_" + secrets.token_hex(6),
                    "name": name,
                    "email": email,
                    "username": username or derive_username(email),
                    "passwordHash": hash_password(password),
                    "provider": "password",
                    "picture": "",
                    "createdAt": now_ms(),
                }
                write_record("users", user["id"], user)
                return self.send_json_cookie(
                    201, {"ok": True, "user": public_user(user)}, self.start_session(user["id"])
                )

            if action == "login":
                body = self.read_json()
                identifier = clean_text(body.get("identifier") or body.get("email"), 120)
                password = body.get("password") or ""
                if not identifier or not password:
                    return self.send_json(400, {"error": "missing_credentials"})
                user = find_by_identifier(identifier)
                if not user or not user.get("passwordHash"):
                    if user:
                        return self.send_json(401, {"error": "use_google"})
                    return self.send_json(401, {"error": "bad_credentials"})
                if not password_matches(password, user["passwordHash"]):
                    return self.send_json(401, {"error": "bad_credentials"})
                return self.send_json_cookie(
                    200, {"ok": True, "user": public_user(user)}, self.start_session(user["id"])
                )

            if action == "google":
                body = self.read_json()
                try:
                    payload = verify_google_token_dev(body.get("credential"))
                except ValueError as err:
                    code = str(err)
                    status = 503 if code == "google_not_configured" else 401
                    return self.send_json(status, {"error": code})
                email = payload["email"].lower()
                user = find_user(lambda d: (d.get("email") or "").lower() == email)
                created = user is None
                if user:
                    user["picture"] = payload.get("picture") or user.get("picture", "")
                    user["name"] = user.get("name") or payload.get("name", "")
                    user["googleSub"] = payload.get("sub")
                    user["lastLoginAt"] = now_ms()
                else:
                    user = {
                        "id": "u_" + secrets.token_hex(6),
                        "name": (payload.get("name") or email.split("@")[0])[:80],
                        "email": email,
                        "username": derive_username(email),
                        "passwordHash": "",
                        "provider": "google",
                        "googleSub": payload.get("sub"),
                        "picture": payload.get("picture", ""),
                        "createdAt": now_ms(),
                    }
                write_record("users", user["id"], user)
                return self.send_json_cookie(
                    200,
                    {"ok": True, "user": public_user(user), "created": created},
                    self.start_session(user["id"]),
                )

            return self.send_json(400, {"error": "unknown_action"})
        except Exception as err:
            return self.send_json(500, {"error": "server_error", "message": str(err)})

    def handle_sessions(self, method, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        record_id = (query.get("id") or [""])[0]
        token = (query.get("token") or [""])[0]
        try:
            if method == "GET" and not record_id:
                return self.send_json(
                    200,
                    {"ok": True, "service": "sessions", "count": len(all_records("sessions"))},
                )
            if method == "GET":
                doc = read_record("sessions", record_id)
                if not doc:
                    return self.send_json(404, {"error": "not_found"})
                if not token or token != doc.get("token"):
                    return self.send_json(403, {"error": "bad_token"})
                return self.send_json(200, {"ok": True, "session": without_token(doc)})
            if method == "POST":
                value, error = validate_session(self.read_json())
                if error:
                    return self.send_json(400, {"error": error})
                doc = {
                    "id": "ss_" + secrets.token_hex(6),
                    "token": "tk_" + secrets.token_hex(6),
                    **value,
                    "status": "requested",
                    "createdAt": now_ms(),
                }
                write_record("sessions", doc["id"], doc)
                return self.send_json(
                    201,
                    {"ok": True, "id": doc["id"], "token": doc["token"], "session": without_token(doc)},
                )
            return self.send_json(405, {"error": "method_not_allowed"})
        except Exception as err:
            return self.send_json(500, {"error": "server_error", "message": str(err)})


def main():
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving Space4Climate on http://127.0.0.1:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
