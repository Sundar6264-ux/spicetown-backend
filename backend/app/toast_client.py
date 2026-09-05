"""Thin client for the Toast Orders API.

NOTE: field paths below follow Toast's published Orders API shape as of this
writing (POST /authentication/v1/authentication/login for a client-credentials
token, GET /orders/v2/ordersBulk?businessDate=YYYYMMDD for a day's orders,
paginated). Toast's response envelope has shifted across API versions before —
verify token/order field names against a live sandbox call before relying on
this in production, and adjust `_extract_access_token` / the order parsing in
`services/sales_sync.py` if they don't match.
"""

import datetime as dt
import time

import httpx

from app.config import get_settings

_TOKEN_CACHE: dict[str, tuple[str, float]] = {}


class ToastAPIError(RuntimeError):
    pass


def _extract_access_token(payload: dict) -> tuple[str, int]:
    # Toast wraps the token in a "token" object; expiresIn is in seconds.
    token_obj = payload.get("token") or payload
    access_token = token_obj.get("accessToken")
    expires_in = token_obj.get("expiresIn", 3600)
    if not access_token:
        raise ToastAPIError(f"Unexpected Toast auth response shape: {payload!r}")
    return access_token, expires_in


def get_access_token(client: httpx.Client) -> str:
    settings = get_settings()
    cache_key = settings.toast_client_id
    cached = _TOKEN_CACHE.get(cache_key)
    if cached and cached[1] > time.time() + 60:
        return cached[0]

    resp = client.post(
        f"{settings.toast_api_base}/authentication/v1/authentication/login",
        json={
            "clientId": settings.toast_client_id,
            "clientSecret": settings.toast_client_secret,
            "userAccessType": "TOAST_MACHINE_CLIENT",
        },
        timeout=30,
    )
    resp.raise_for_status()
    access_token, expires_in = _extract_access_token(resp.json())
    _TOKEN_CACHE[cache_key] = (access_token, time.time() + expires_in)
    return access_token


def fetch_employees() -> list[dict]:
    """Return raw employee JSON objects from Toast's Labor API (not paginated
    in practice - the restaurant's real employee list is small enough that a
    single call returns everything; add pagination here if that ever stops
    being true).
    """
    settings = get_settings()
    with httpx.Client() as client:
        token = get_access_token(client)
        headers = {
            "Authorization": f"Bearer {token}",
            "Toast-Restaurant-External-ID": settings.toast_restaurant_guid,
        }
        resp = client.get(
            f"{settings.toast_api_base}/labor/v1/employees",
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()


def fetch_orders_for_business_date(business_date: dt.date) -> list[dict]:
    """Return raw order JSON objects for a Toast business date, fully paginated."""
    settings = get_settings()
    date_str = business_date.strftime("%Y%m%d")

    orders: list[dict] = []
    with httpx.Client() as client:
        token = get_access_token(client)
        headers = {
            "Authorization": f"Bearer {token}",
            "Toast-Restaurant-External-ID": settings.toast_restaurant_guid,
        }

        page = 1
        page_size = 100
        while True:
            resp = client.get(
                f"{settings.toast_api_base}/orders/v2/ordersBulk",
                headers=headers,
                params={"businessDate": date_str, "page": page, "pageSize": page_size},
                timeout=60,
            )
            if resp.status_code == 404:
                # Toast returns 404 for a business date with no orders yet.
                break
            resp.raise_for_status()
            batch = resp.json()
            if not batch:
                break
            orders.extend(batch)
            if len(batch) < page_size:
                break
            page += 1

    return orders
