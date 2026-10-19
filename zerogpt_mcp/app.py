"""Private, stateless Streamable HTTP MCP bridge for ZeroGPT Business API.

No third party text leaves this service unless a request is explicitly authorized,
provider credentials are configured, and the check_text_zerogpt tool is called.
"""
from __future__ import annotations

import hmac
import os
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

PROVIDER_URL = "https://api.zerogpt.com"
TOKEN = os.environ.get("MCP_BEARER_TOKEN", "")
MAX_CHARS = 15000
if len(TOKEN) < 32:
    raise RuntimeError("MCP_BEARER_TOKEN must contain at least 32 characters")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def rpc_result(rpc_id: Any, result: dict | None = None, error: dict | None = None):
    payload = {"jsonrpc": "2.0", "id": rpc_id}
    payload["error" if error is not None else "result"] = error if error is not None else result
    return JSONResponse(payload, headers={"Cache-Control": "no-store"})


def mcp_error(message: str) -> dict:
    return {"content": [{"type": "text", "text": message}], "isError": True}


TOOL = {
    "name": "check_text_zerogpt",
    "title": "Check selected text with ZeroGPT",
    "description": ("Check an explicitly user-selected text through the paid ZeroGPT.com "
                    "Business API. Sends this text to an external service and may incur "
                    "charges. Only call after the user requests a ZeroGPT check, "
                    "never automatically or in background. AI scores are not proof of authorship."),
    "inputSchema": {
        "type": "object", "properties": {
            "input_text": {"type": "string", "minLength": 20, "maxLength": MAX_CHARS,
                           "description": "Exact text explicitly selected by the user for ZeroGPT checking."}},
        "required": ["input_text"], "additionalProperties": False},
    "annotations": {"readOnlyHint": False, "destructiveHint": False,
                     "idempotentHint": False, "openWorldHint": True},
}


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "upstream_ready": bool(os.environ.get("ZEROGPT_API_KEY")), "provider_auth": "ApiKey"}


async def upstream_check(text: str) -> dict[str, Any]:
    """Call official Business API using ApiKey authentication, tested against /myStats.

    There is no need for an email/password or a Google OAuth browser session.
    A text detection request can incur a small provider charge.
    """
    api_key = os.environ.get("ZEROGPT_API_KEY", "")
    if not api_key:
        raise ValueError("ZeroGPT Business API key is not configured.")
    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            res = await client.post(
                PROVIDER_URL + "/api/detect/detectText",
                headers={"ApiKey": api_key},
                json={"input_text": text},
            )
    except httpx.HTTPError:
        raise ValueError("ZeroGPT Business API could not be reached.")
    if res.status_code == 402:
        raise ValueError("ZeroGPT API account has insufficient prepaid balance.")
    if res.status_code in (401, 403):
        raise ValueError(
            f"ZeroGPT rejected the detection request (HTTP {res.status_code}); "
            "check outbound IP whitelist, account permissions, or payment plan."
        )
    if res.status_code == 429:
        raise ValueError("ZeroGPT API rate limit reached.")
    if not res.is_success:
        raise ValueError(f"ZeroGPT API returned HTTP {res.status_code}.")
    try:
        result = res.json()
    except ValueError:
        raise ValueError("ZeroGPT API returned malformed JSON.")
    if not isinstance(result, dict) or result.get("success") is False:
        code = result.get("code", "?") if isinstance(result, dict) else "?"
        message = result.get("message", "No explanation") if isinstance(result, dict) else "Unknown"
        raise ValueError(f"ZeroGPT detection failed ({code}): {str(message)[:180]}")
    data = result.get("data")
    if not isinstance(data, dict):
        raise ValueError("ZeroGPT returned no detection data.")
    out = {"provider": "ZeroGPT.com Business API",
           "caution": "Detector scores cannot establish whether a human or AI authored the text."}
    for name in ("fakePercentage", "aiWords", "textWords", "h", "feedback",
                 "cost", "isHuman", "paragraphScore"):
        if name in data:
            out[name] = data[name]
    if not any(key in out for key in ("fakePercentage", "h", "paragraphScore")):
        raise ValueError("ZeroGPT returned no documented analysis scores.")
    return out

@app.post("/mcp")
async def mcp(request: Request):
    try:
        msg = await request.json()
    except ValueError:
        return rpc_result(None, error={"code": -32700, "message": "Parse error"})
    if not isinstance(msg, dict):
        return rpc_result(None, error={"code": -32600, "message": "Invalid JSON-RPC request"})
    method, rpc_id = msg.get("method"), msg.get("id")
    if method == "notifications/initialized":
        return Response(status_code=202)
    if method == "initialize":
        return rpc_result(rpc_id, {"protocolVersion": "2025-06-18",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "zerogpt-private-checker", "version": "0.1.0"},
            "instructions": "Never send text to ZeroGPT without an explicit user request. Detection is paid; scores are not proof of authorship."})
    if method == "ping":
        return rpc_result(rpc_id, {})
    if method == "tools/list":
        return rpc_result(rpc_id, {"tools": [TOOL]})
    if method != "tools/call":
        return rpc_result(rpc_id, error={"code": -32601, "message": "Method not found"})
    presented = request.headers.get("Authorization", "")
    if not presented.startswith("Bearer ") or not hmac.compare_digest(presented[7:], TOKEN):
        return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "result": mcp_error(
            "Private connector authentication required.")}, status_code=401,
            headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"})
    params = msg.get("params")
    if not isinstance(params, dict) or params.get("name") != "check_text_zerogpt":
        return rpc_result(rpc_id, error={"code": -32602, "message": "Unknown tool"})
    args = params.get("arguments")
    if not isinstance(args, dict) or set(args) != {"input_text"}:
        return rpc_result(rpc_id, error={"code": -32602, "message": "Provide only input_text"})
    text = args["input_text"]
    if not isinstance(text, str) or len(text.strip()) < 20 or len(text) > MAX_CHARS:
        return rpc_result(rpc_id, error={"code": -32602, "message": "Input text must be 20 to 15000 characters"})
    try:
        result = await upstream_check(text)
        return rpc_result(rpc_id, {"content": [{"type": "text", "text": __import__("json").dumps(
            result, ensure_ascii=False)}], "structuredContent": result, "isError": False})
    except ValueError as exc:
        return rpc_result(rpc_id, mcp_error(str(exc)))


@app.get("/mcp")
async def mcp_get():
    return Response(status_code=405, headers={"Allow": "POST"})


# Safe, one-time diagnostic of API-key-only access (read-only requests).
# Activation requires ZEROGPT_DIAG_PROBE=1. No text is sent, and no usage is billed.
@app.on_event("startup")
async def read_only_api_probe():
    if os.environ.get("ZEROGPT_DIAG_PROBE") != "1":
        return
    import asyncio
    import ipaddress

    async def check():
        key = os.environ.get("ZEROGPT_API_KEY", "")
        print("ZeroGPT diagnostic: API key present=" + str(bool(key)), flush=True)
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            try:
                ip_response = await client.get("https://api.ipify.org?format=json")
                value = ip_response.json().get("ip") if ip_response.is_success else None
                try:
                    safe_ip = str(ipaddress.ip_address(value))
                except (ValueError, TypeError):
                    safe_ip = "unavailable"
                print("ZeroGPT diagnostic: actual Render IPv4 egress=" + safe_ip, flush=True)
            except (httpx.HTTPError, ValueError):
                print("ZeroGPT diagnostic: egress IP lookup unavailable", flush=True)
            if not key:
                return
            for method, headers in (
                ("ApiKey", {"ApiKey": key}),
                ("BearerApiKey", {"Authorization": "Bearer " + key}),
            ):
                try:
                    response = await client.get(
                        PROVIDER_URL + "/api/dashboard/myStats",
                        headers=headers,
                    )
                    try:
                        body = response.json()
                    except ValueError:
                        body = None
                    is_success = (
                        response.is_success and
                        isinstance(body, dict) and
                        body.get("success") is True
                    )
                    print(
                        "ZeroGPT diagnostic: method=" + method +
                        " HTTP=" + str(response.status_code) +
                        " success=" + str(is_success),
                        flush=True,
                    )
                    if is_success:
                        data = body.get("data")
                        if method == "ApiKey" and isinstance(data, dict):
                            print(
                                "ZeroGPT diagnostic: stats fields=" +
                                ",".join(sorted(str(k) for k in data.keys())),
                                flush=True
                            )
                            whitelist = data.get("ipWhitelist")
                            if isinstance(whitelist, list):
                                safe_ips = []
                                for entry in whitelist:
                                    if isinstance(entry, str):
                                        safe_ips.append(entry[:45])
                                    elif isinstance(entry, dict):
                                        value = entry.get("ip", entry.get("address", entry.get("ipAddress")))
                                        if isinstance(value, str):
                                            safe_ips.append(value[:45])
                                print(
                                    "ZeroGPT diagnostic: whitelist=" + str(safe_ips),
                                    flush=True
                                )
                            elif isinstance(whitelist, str):
                                print(
                                    "ZeroGPT diagnostic: whitelist=" +
                                    whitelist[:300], flush=True
                                )
                            if (
                                os.environ.get("ZEROGPT_DIAG_FIX_IP") == "1"
                                and method == "ApiKey"
                                and isinstance(whitelist, str)
                                and safe_ip != "unavailable"
                            ):
                                entries = [entry.strip() for entry in whitelist.split(",") if entry.strip()]
                                if safe_ip not in entries:
                                    try:
                                        new_csv = ",".join(entries + [safe_ip])
                                        updated = await client.post(
                                            PROVIDER_URL + "/api/dashboard/setIpWhitelist",
                                            headers={"ApiKey": key},
                                            json={"string": new_csv}
                                        )
                                        try:
                                            new_body = updated.json()
                                        except ValueError:
                                            new_body = None
                                        success = (
                                            updated.is_success and
                                            isinstance(new_body, dict) and
                                            new_body.get("success") is True
                                        )
                                        print(
                                            "ZeroGPT diagnostic: whitelist extension HTTP=" +
                                            str(updated.status_code) +
                                            " success=" + str(success), flush=True
                                        )
                                        if success:
                                            verify = await client.get(
                                                PROVIDER_URL + "/api/dashboard/myStats",
                                                headers={"ApiKey": key}
                                            )
                                            if verify.is_success:
                                                new_body = verify.json()
                                                confirmed = (
                                                    new_body.get("data", {}).get("ipWhitelist", "")
                                                    if isinstance(new_body, dict) else ""
                                                )
                                                print(
                                                    "ZeroGPT diagnostic: updated whitelist=" +
                                                    str(confirmed)[:300], flush=True
                                                )
                                    except (httpx.HTTPError, ValueError):
                                        print(
                                            "ZeroGPT diagnostic: whitelist extension request failed",
                                            flush=True
                                        )
                            for section in ("subscription", "balancePackage"):
                                part = data.get(section)
                                if isinstance(part, dict):
                                    safe = {}
                                    for field, val in part.items():
                                        if str(field).lower() in (
                                            "id", "status", "typeid", "packageid", "packagename",
                                            "description", "isactive", "active", "price",
                                            "fixedpricepermonth", "costperthousand", "balance"
                                        ) and isinstance(val, (str, int, float, bool)):
                                            safe[field] = val
                                    print(
                                        "ZeroGPT diagnostic: " + section + " " +
                                        str(safe)[:300] + " fields=" +
                                        ",".join(sorted(str(k) for k in part.keys())),
                                        flush=True
                                    )
                                elif isinstance(part, list):
                                    print("ZeroGPT diagnostic: " + section + " items=" +
                                          str(len(part)), flush=True)
                                else:
                                    print("ZeroGPT diagnostic: " + section + " type=" +
                                          type(part).__name__, flush=True)
                            for field, val in data.items():
                                name = str(field).lower()
                                if any(tag in name for tag in ("package", "plan", "subscription", "purchase", "credit")):
                                    if isinstance(val, (str, int, float, bool)) and len(str(val)) < 80:
                                        print(
                                            "ZeroGPT diagnostic: account " + str(field) +
                                            "=" + str(val), flush=True
                                        )
                        if isinstance(data, dict):
                            for field, val in data.items():
                                if "balance" in field.lower() or "credit" in field.lower():
                                    if isinstance(val, (int, float)) and not isinstance(val, bool):
                                        print(
                                            "ZeroGPT diagnostic: account " + field +
                                            "=" + str(val), flush=True
                                        )
                except httpx.HTTPError:
                    print("ZeroGPT diagnostic: method=" + method + " network failure", flush=True)



            try:
                pkg = await client.get(
                    PROVIDER_URL + "/api/dashboard/getPackages",
                    headers={"ApiKey": key}
                )
                print(
                    "ZeroGPT diagnostic: getPackages HTTP=" + str(pkg.status_code),
                    flush=True
                )
                if pkg.is_success:
                    info = pkg.json()
                    print(
                        "ZeroGPT diagnostic: getPackages success=" +
                        str(info.get("success", "unknown") if isinstance(info, dict) else "unknown"),
                        flush=True
                    )
                    data = info.get("data") if isinstance(info, dict) else None
                    if isinstance(data, list):
                        print("ZeroGPT diagnostic: available API packages=" + str(len(data)), flush=True)
                        for option in data[:10]:
                            if isinstance(option, dict):
                                summary = {k: v for k, v in option.items()
                                           if str(k).lower() in
                                           ("name", "title", "id", "type", "price", "priceusd", "priceper1000",
                                            "isactive", "currency", "description")
                                           and isinstance(v, (str, int, float, bool))}
                                print(
                                    "ZeroGPT diagnostic: package " + str(summary)[:280],
                                    flush=True
                                )
            except (httpx.HTTPError, ValueError):
                print("ZeroGPT diagnostic: getPackages unavailable", flush=True)


            try:
                billing = await client.get(
                    PROVIDER_URL + "/api/dashboard/billing-history",
                    headers={"ApiKey": key}
                )
                print(
                    "ZeroGPT diagnostic: billing-history HTTP=" +
                    str(billing.status_code),
                    flush=True
                )
                if billing.is_success:
                    content = billing.json()
                    bills = content.get("data") if isinstance(content, dict) else None
                    if isinstance(bills, list):
                        print(
                            "ZeroGPT diagnostic: billing items=" +
                            str(len(bills)), flush=True
                        )
                    elif isinstance(bills, dict):
                        print(
                            "ZeroGPT diagnostic: billing fields=" +
                            ",".join(sorted(str(k) for k in bills.keys())),
                            flush=True
                        )
            except (httpx.HTTPError, ValueError):
                print("ZeroGPT diagnostic: billing-history unavailable", flush=True)

            # A fixed public technical sample; only used for an explicitly enabled
            # one-time integration test, never a user's editorial draft.
            if os.environ.get("ZEROGPT_DIAG_SAMPLE") == "1":
                sample = (
                    "Это техническая проверка работы API. Данный текст не является "
                    "личным документом и не содержит конфиденциальных данных. "
                    "Мы отправляем его исключительно для тестирования соединения. "
                    "Проверка должна вернуть ответ с оценкой текста, временем "
                    "обработки и количеством слов. Точные проценты здесь не "
                    "имеют редакционного значения. Главное, чтобы сервер "
                    "подтвердил успешный обмен данными с ZeroGPT, а результат "
                    "соответствовал документированной структуре ответа. "
                    "После теста автоматическую проверку необходимо выключить."
                )
                try:
                    result = await upstream_check(sample)
                    print(
                        "ZeroGPT diagnostic: sample analysis success=True "
                        "score=" + str(result.get("fakePercentage", "unknown")) +
                        " words=" + str(result.get("textWords", "unknown")) +
                        " cost=" + str(result.get("cost", "unreported")),
                        flush=True,
                    )
                except ValueError as exc:
                    print(
                        "ZeroGPT diagnostic: sample analysis error=" +
                        str(exc)[:250], flush=True
                    )

    asyncio.create_task(check())
