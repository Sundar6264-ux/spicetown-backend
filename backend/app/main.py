import logging
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import ask, auth, digest, inventory, jobs, ordering, orders, reconciliation, reports, sales, transfers
from app.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(title="Spicetown Backend", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,  # required for the session cookie to be sent/accepted
)

app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(inventory.router)
app.include_router(sales.router)
app.include_router(ordering.router)
app.include_router(reports.router)
app.include_router(reconciliation.router)
app.include_router(ask.router)
app.include_router(digest.router)
app.include_router(transfers.router)
app.include_router(orders.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serves the production frontend build (`npm run build` in frontend/) directly
# from the backend, so persistent deployment only needs one process/port. Only
# mounted if the build exists, so `npm run dev` + CORS still works untouched
# for local frontend development.
_frontend_dist = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
