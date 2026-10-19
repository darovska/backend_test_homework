# ZeroGPT Private MCP (technical preview)

ZeroGPT Business API MCP connector, private to one editor. Requires MCP_BEARER_TOKEN >= 32 characters.

Render setup: Python, build command: pip install -r zerogpt_mcp/requirements.txt, start command: uvicorn zerogpt_mcp.app:app --host 0.0.0.0 --port $PORT

HTTP MCP endpoint: /mcp. Streamable HTTP JSON-RPC with a Bearer private connector token. Do NOT store this connector token in GitHub or the plugin package. The ChatGPT plugin connection flow must collect it securely using API-key authentication.

Provider credentials required for actual text checks: ZEROGPT_EMAIL, ZEROGPT_API_PASSWORD (Business API account password, not Gmail password), and ZEROGPT_API_KEY. Check outbound IP allowlisting with ZeroGPT. Website sign-in via Google alone does not confer API authentication.

Explicit user-requested checks only. No text logs or fabricated percentages. Detector scores do not prove authorship.

Health check GET /healthz returns status and upstream_ready. Verification without provider credentials is limited to server startup and mock tests; do not claim live ZeroGPT checking works until a real API check succeeds.
