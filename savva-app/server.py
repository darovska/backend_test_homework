"""Password-protected family dashboard backed by Render PostgreSQL.
Public source contains no children's records, passwords or database credentials.
"""
from __future__ import annotations

import base64
import copy
import gzip
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import time
from collections import defaultdict
from pathlib import Path
from threading import Lock
from typing import Any

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "site"
MONTHS = (
    "Октябрь 2026", "Ноябрь 2026", "Декабрь 2026", "Январь 2027", "Февраль 2027", "Март 2027",
    "Апрель 2027", "Май 2027", "Июнь 2027", "Июль 2027", "Август 2027", "Сентябрь 2027",
)
CATEGORIES = {"Сад", "Кружки", "Прогулки", "Досуг"}
STATUSES = {"Сад", "Выходной", "Больничный", "Остался дома"}
DATE_RE = re.compile(r"^20\d\d-\d\d-\d\d$")
COOKIE_NAME = "savva_family_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 14
ATTEMPTS: dict[str, list[float]] = defaultdict(list)
ATTEMPTS_LOCK = Lock()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    if not password or len(password) > 512:
        raise ValueError("Недопустимая длина пароля")
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return salt.hex() + ":" + digest.hex()


def check_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest = stored.split(":")
        expected = bytes.fromhex(digest)
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=16384, r=8, p=1, dklen=len(expected))
        return hmac.compare_digest(expected, actual)
    except (ValueError, TypeError):
        return False


def signer() -> URLSafeTimedSerializer:
    secret = os.environ.get("SESSION_SIGNING_KEY", "")
    if len(secret) < 32:
        raise HTTPException(503, "Сеансы еще не настроены")
    return URLSafeTimedSerializer(secret, salt="savva-family-dashboard-v1")


def session(request: Request) -> dict[str, str]:
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        raise HTTPException(401, "Войдите в дневник")
    try:
        data = signer().loads(token, max_age=SESSION_MAX_AGE)
    except (SignatureExpired, BadSignature):
        raise HTTPException(401, "Сеанс истек. Войдите снова")
    if data.get("role") != "editor" or not data.get("csrf"):
        raise HTTPException(401, "Сеанс не действителен")
    return data


def assert_mutation(request: Request) -> dict[str, str]:
    data = session(request)
    expected = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    origin = request.headers.get("origin", "")
    if expected and origin != expected:
        raise HTTPException(403, "Некорректный адрес отправителя")
    if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), data["csrf"]):
        raise HTTPException(403, "Необходимо обновить сеанс")
    return data


def db_url() -> str:
    value = os.environ.get("DATABASE_URL", "").strip()
    if not value:
        raise HTTPException(503, "Нужно подключить PostgreSQL в настройках Render (DATABASE_URL)")
    return value


def connect():
    return psycopg.connect(db_url(), connect_timeout=7, autocommit=False)


def ensure_tables(con) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS dashboard_snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision BIGINT NOT NULL DEFAULT 1,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")


def get_payload(con, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    row = con.execute("SELECT revision, payload FROM dashboard_snapshot WHERE id = 1" + suffix).fetchone()
    return (int(row[0]), row[1]) if row else None

def seed_if_empty(con) -> None:
    """Import a private one-time seed from a Render environment variable, never GitHub."""
    compressed = os.environ.get("INITIAL_SNAPSHOT_GZIP_B64", "")
    if not compressed or get_payload(con):
        return
    try:
        raw = gzip.decompress(base64.b64decode(compressed, validate=True))
        if len(raw) > 2_000_000:
            raise ValueError("Превышен допустимый размер данных")
        data = json.loads(raw)
        validate_data(data)
    except Exception:
        raise HTTPException(503, "Не удалось проверить исходную копию расписания")
    con.execute("INSERT INTO dashboard_snapshot (id, revision, payload) VALUES (1, 1, %s::jsonb) ON CONFLICT (id) DO NOTHING", (json.dumps(data, ensure_ascii=False),))


def validate_data(data: Any) -> None:
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("months"), dict):
        raise ValueError("Неверный формат файла дневника")
    if set(data["months"]) != set(MONTHS):
        raise ValueError("Дневник должен содержать все 12 месяцев")
    total = 0
    for month_name, month in data["months"].items():
        if not isinstance(month, dict) or not isinstance(month.get("days"), dict):
            raise ValueError("Неверный формат месяца " + month_name)
        if len(month["days"]) > 31 or len(month.get("weeks", [])) > 6:
            raise ValueError("В месяце слишком много записей")
        expected_prefix = {
            "Январь":"01", "Февраль":"02", "Март":"03", "Апрель":"04", "Май":"05", "Июнь":"06",
            "Июль":"07", "Август":"08", "Сентябрь":"09", "Октябрь":"10", "Ноябрь":"11", "Декабрь":"12",
        }[month_name.split(" ")[0]]
        expected_year = month_name[-4:]
        for date, day in month["days"].items():
            if not DATE_RE.fullmatch(date) or not date.startswith(expected_year + "-" + expected_prefix + "-"):
                raise ValueError("Некорректная дата: " + str(date))
            if not isinstance(day, dict) or day.get("status") not in STATUSES:
                raise ValueError("Некорректный статус дня")
            if len(str(day.get("notes", ""))) > 4000:
                raise ValueError("Слишком длинное примечание")
            events = day.get("events")
            if not isinstance(events, list) or len(events) > 40:
                raise ValueError("Слишком много занятий за день")
            total += len(events)
            for e in events:
                if not isinstance(e, dict) or not isinstance(e.get("id"), str) or not 1 <= len(e["id"]) <= 150:
                    raise ValueError("Некорректный идентификатор занятия")
                if not isinstance(e.get("title"), str) or not 1 <= len(e["title"]) <= 200:
                    raise ValueError("Некорректное название занятия")
                if e.get("category") not in CATEGORIES or not isinstance(e.get("attended"), bool):
                    raise ValueError("Некорректная категория или галочка")
                minutes = e.get("minutes")
                if isinstance(minutes, bool) or not isinstance(minutes, (int, float)) or not math.isfinite(minutes) or not 0 <= minutes <= 1440:
                    raise ValueError("Некорректная длительность занятия")
                if len(str(e.get("note", ""))) > 2000 or len(str(e.get("time", ""))) > 50:
                    raise ValueError("Слишком длинное описание занятия")
        weeks = month.get("weeks")
        if not isinstance(weeks, list):
            raise ValueError("Не указан учет логопеда")
        for w in weeks:
            if not isinstance(w, dict) or not isinstance(w.get("count"), (float, int)) or not 0 <= w["count"] <= 20:
                raise ValueError("Некорректный учет логопеда")
    if total > 4000:
        raise ValueError("Слишком много занятий")


def apply_patch(snapshot: dict, ops: list) -> dict:
    if not isinstance(ops, list) or not 1 <= len(ops) <= 500:
        raise ValueError("Некорректный набор изменений")
    new = copy.deepcopy(snapshot)
    for op in ops:
        if not isinstance(op, dict) or op.get("month") not in MONTHS or op.get("type") not in ("day", "weeks"):
            raise ValueError("Некорректный адрес изменения")
        month = op["month"]
        typ = op["type"]
        if typ == "day":
            date = op.get("date")
            if not isinstance(date, str) or date not in new["months"][month]["days"]:
                raise ValueError("Неизвестная дата")
            source = new["months"][month]["days"][date]
            target = op.get("value")
            expected = op.get("base")
            if source != expected:
                if source == target:
                    continue
                raise RuntimeError("Другой участник изменил тот же день. Сохраните свою копию и обновите данные.")
            if not isinstance(target, dict) or target.get("date") != date:
                raise ValueError("Неверная дата в изменении")
            new["months"][month]["days"][date] = target
        else:
            source = new["months"][month]["weeks"]
            target = op.get("value")
            if source != op.get("base"):
                if source == target:
                    continue
                raise RuntimeError("Другой участник изменил учет логопеда. Обновите данные.")
            new["months"][month]["weeks"] = target
    validate_data(new)
    return new


class LoginRequest(BaseModel):
    password: str


@app.get("/")
def homepage():
    return FileResponse(PUBLIC / "index.html", media_type="text/html", headers={"Cache-Control": "no-store", "X-Content-Type-Options":"nosniff"})


@app.get("/sync.js")
def script():
    return FileResponse(PUBLIC / "sync.js", media_type="application/javascript", headers={"Cache-Control": "no-store", "X-Content-Type-Options":"nosniff"})


@app.get("/api/health")
def health():
    # Report verified connectivity rather than only the presence of DATABASE_URL.
    # No private timetable data or credentials are returned to unauthenticated callers.
    try:
        with connect() as con:
            con.execute("SELECT 1")
        available = True
    except Exception:
        available = False
    return {"ok": True, "database_connected": available, "service": "savva-family"}


@app.post("/api/login")
def login(request: Request, body: LoginRequest):
    expected = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if expected and request.headers.get("origin") != expected:
        raise HTTPException(403, "Некорректный адрес отправителя")
    stored = os.environ.get("EDITOR_PASSWORD_HASH", "")
    if not stored:
        raise HTTPException(503, "Вход еще не настроен")
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    with ATTEMPTS_LOCK:
        ATTEMPTS[ip] = [t for t in ATTEMPTS[ip] if now - t < 900]
        if len(ATTEMPTS[ip]) >= 8:
            raise HTTPException(429, "Слишком много попыток. Повторите позже")
    if not check_password(body.password, stored):
        with ATTEMPTS_LOCK:
            ATTEMPTS[ip].append(now)
        raise HTTPException(401, "Неверный пароль")
    with ATTEMPTS_LOCK:
        ATTEMPTS.pop(ip, None)
    csrf = secrets.token_urlsafe(24)
    token = signer().dumps({"role": "editor", "csrf": csrf})
    resp = JSONResponse({"ok": True, "csrf": csrf})
    resp.set_cookie(COOKIE_NAME, token, max_age=SESSION_MAX_AGE, secure=True, httponly=True, samesite="lax", path="/")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/session")
def session_status(request: Request):
    data = session(request)
    return {"ok":True,"csrf":data["csrf"]}


@app.get("/api/data")
def read_data(request: Request):
    session(request)
    try:
        with connect() as con:
            ensure_tables(con)
            seed_if_empty(con)
            row = get_payload(con)
            con.commit()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Нет соединения с базой данных")
    resp = JSONResponse({"revision":row[0],"data":row[1]} if row else {"needs_import":True})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/import")
async def import_data(request: Request):
    assert_mutation(request)
    if int(request.headers.get("content-length", "0") or 0) > 2_000_000:
        raise HTTPException(413, "Файл слишком большой")
    data = await request.json()
    try:
        validate_data(data)
        with connect() as con:
            ensure_tables(con)
            if get_payload(con, lock=True):
                raise HTTPException(409, "Данные уже загружены. Импорт не должен перезаписать ваши изменения")
            con.execute("INSERT INTO dashboard_snapshot (id, revision, payload) VALUES (1, 1, %s::jsonb)", (json.dumps(data, ensure_ascii=False),))
            con.commit()
    except ValueError as e:
        raise HTTPException(422, str(e))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Не удалось загрузить данные в базу")
    return {"ok": True, "revision": 1}


@app.post("/api/patch")
async def patch_data(request: Request):
    assert_mutation(request)
    if int(request.headers.get("content-length", "0") or 0) > 2_000_000:
        raise HTTPException(413, "Слишком большой запрос")
    body = await request.json()
    ops = body.get("ops") if isinstance(body, dict) else None
    try:
        with connect() as con:
            ensure_tables(con)
            row = get_payload(con, lock=True)
            if row is None:
                raise HTTPException(409, "Сначала загрузите данные")
            revision, current = row
            changed = apply_patch(current, ops)
            if changed != current:
                con.execute("UPDATE dashboard_snapshot SET payload=%s::jsonb,revision=revision+1,updated_at=now() WHERE id=1", (json.dumps(changed, ensure_ascii=False),))
                revision += 1
            con.commit()
    except ValueError as e:
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Не удалось сохранить изменения")
    return {"ok": True, "revision": revision}


@app.post("/api/logout")
def logout(request: Request):
    assert_mutation(request)
    resp=JSONResponse({"ok":True})
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp