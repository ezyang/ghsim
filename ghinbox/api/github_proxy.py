"""
GitHub API proxy routes.

Proxies requests to GitHub's REST and GraphQL APIs using the stored token.
"""

import os

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from ghinbox.token import load_token

router = APIRouter(prefix="/github", tags=["github-proxy"])

GITHUB_API_BASE = "https://api.github.com"

# Shared httpx client (created lazily)
_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    """Get or create the shared httpx client."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


def get_token() -> str | None:
    """Get the GitHub token for the configured account."""
    account = os.environ.get("GHSIM_ACCOUNT")
    if not account:
        return None
    return load_token(account)


@router.api_route(
    "/rest/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    summary="GitHub REST API proxy",
    description="Proxies requests to GitHub's REST API with authentication.",
    include_in_schema=False,
)
async def rest_proxy(path: str, request: Request) -> Response:
    """
    Proxy requests to GitHub REST API.

    All HTTP methods are supported. Query parameters and request body
    are forwarded as-is.
    """
    token = get_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="No GitHub token configured. Start server with --account.",
        )

    # Build target URL
    url = f"{GITHUB_API_BASE}/{path}"

    # Forward query parameters
    if request.query_params:
        url += f"?{request.query_params}"

    # Build headers
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    # Get request body if present
    body = await request.body()

    # Make the proxied request
    client = get_client()
    response = await client.request(
        method=request.method,
        url=url,
        headers=headers,
        content=body if body else None,
    )

    # Return the response with appropriate headers
    return Response(
        content=response.content,
        status_code=response.status_code,
        headers={
            "Content-Type": response.headers.get("Content-Type", "application/json"),
        },
    )


@router.post(
    "/graphql",
    summary="GitHub GraphQL API proxy",
    description="Proxies GraphQL queries to GitHub's GraphQL API with authentication.",
)
async def graphql_proxy(request: Request) -> Response:
    """
    Proxy GraphQL queries to GitHub.

    Expects a JSON body with 'query' and optional 'variables' fields.
    """
    token = get_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="No GitHub token configured. Start server with --account.",
        )

    # Get request body
    body = await request.body()

    # Build headers
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Make the proxied request
    client = get_client()
    response = await client.post(
        f"{GITHUB_API_BASE}/graphql",
        headers=headers,
        content=body,
    )

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers={
            "Content-Type": response.headers.get("Content-Type", "application/json"),
        },
    )
