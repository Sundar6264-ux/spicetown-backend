from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./spicetown.db"

    toast_api_base: str = "https://ws-api.toasttab.com"
    toast_client_id: str = ""
    toast_client_secret: str = ""
    toast_restaurant_guid: str = ""

    sales_sync_hour: int = 4
    sales_sync_minute: int = 0
    toast_timezone: str = "America/New_York"
    # How many trailing days the sync checks for gaps and backfills automatically
    # (e.g. the service was down overnight, or missed a day for any reason).
    sales_sync_backfill_days: int = 14

    # Open Orders "all-time" cache (app/services/open_orders.py). The full
    # scan is slow (~100+ Toast calls, minutes) so it only runs once a day;
    # the today-only refresh is cheap (one call) and runs frequently to keep
    # the common case (an order opening/closing today) fresh.
    open_orders_full_scan_hour: int = 4
    open_orders_full_scan_minute: int = 15
    open_orders_today_refresh_minutes: int = 15

    cors_origins: str = "http://localhost:5173"

    # Ask Inventory Bot (app/services/ask_bot.py) only - nothing else depends on this.
    anthropic_api_key: str = ""

    # Session cookie sent to the browser after login. Secure=True (requires
    # HTTPS) is correct for the real deployment (Tailscale serve terminates
    # HTTPS); flip to False only for local dev over plain http://localhost.
    session_cookie_secure: bool = True
    session_lifetime_days: int = 14

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
