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
    return {"status": "ok", "upstream_ready": all(
        bool(os.environ.get(n)) for n in
        ("ZEROGPT_EMAIL", "ZEROGPT_API_PASSWORD", "ZEROGPT_API_KEY"))}


async def upstream_check(text: str) -> dict[str, Any]:
    email = os.environ.get("ZEROGPT_EMAIL", "")
    password = os.environ.get("ZEROGPT_API_PASSWORD", "")
    api_key = os.environ.get("ZEROGPT_API_KEY", "")
    if not (email and password and api_key):
        raise ValueError("ZeroGPT Business API access is not configured. The website's Google login does not grant API access.")
    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            login = await client.post(PROVIDER_URL + "/api/auth/login", json={
                "email": email, "password": password})
            if not login.is_success:
                raise ValueError(f"ZeroGPT API authentication failed (HTTP {login.status_code}).")
            try:
                token = login.json().get("data", {}).get("token")
            except (ValueError, AttributeError):
                token = None
            if not isinstance(token, str) or not token:
                raise ValueError("ZeroGPT did not issue an API login token.")
            res = await client.post(PROVIDER_URL + "/api/detect/detectText",
                                    headers={"Authorization": "Bearer " + token, "ApiKey": api_key},
                                    json={"input_text": text})
        if res.status_code == 402:
            raise ValueError("ZeroGPT API account has insufficient prepaid balance.")
        if res.status_code in (401, 403):
            raise ValueError("ZeroGPT denied access: check credentials and allowed outbound IPs.")
        if res.status_code == 429:
            raise ValueError("ZeroGPT rate limit reached.")
        if not res.is_success:
            raise ValueError(f"ZeroGPT API returned HTTP {res.status_code}.")
        try:
            result = res.json()
        except ValueError:
            raise ValueError("ZeroGPT returned invalid JSON.")
        if not isinstance(result, dict) or result.get("success") is False:
            raise ValueError("ZeroGPT did not return a successful detection result.")
        data = result.get("data")
        if not isinstance(data, dict):
            raise ValueError("ZeroGPT returned no structured detection result.")
        output = {"provider": "ZeroGPT.com Business API",
                  "caution": "AI detector scores cannot establish authorship."}
        for key in ("fakePercentage", "aiWords", "textWords", "h", "feedback"):
            if key in data:
                output[key] = data[key]
        if "fakePercentage" not in output and "h" not in output:
            raise ValueError("ZeroGPT returned no documented score or highlighted sentences.")
        return output
    except httpx.HTTPError:
        raise ValueError("ZeroGPT API could not be reached.")


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
