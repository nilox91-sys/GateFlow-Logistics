"""
main.py - FastAPI Backend for GateFlow Logistics Hub

Endpoints:
  POST   /check-in              → Portineria registers incoming vehicle
  PATCH  /update-status/{id}   → Magazzino updates vehicle status
  POST   /check-out/{id}        → Portineria registers vehicle departure
  GET    /transits              → Dashboard fetches all active transits
  GET    /export/daily          → Export today's transits to Excel
  WS     /ws                    → WebSocket for real-time dashboard updates
  GET    /                      → Serves the GateFlow frontend (index.html)
  STATIC /static/*              → Serves frontend assets (CSS, JS)
"""
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError

from .database import engine, Base, SessionLocal
from .routers import transits, websockets, auth, logs

from .logger_config import logger

# --- App Setup ---
Base.metadata.create_all(bind=engine)
with SessionLocal() as db:
    auth.create_initial_admin(db)

logger.info("GateFlow backend starting up...")

# Resolve the frontend directory (sibling of backend/)
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(
    title="GateFlow Logistics API",
    description="Professional backend for GateFlow Logistics Hub transit management.",
    version="1.1.0",
)

# CORS configuration
allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = [origin.strip() for origin in allowed_origins_str.split(",")] if allowed_origins_str != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    logger.error(f"Validation error on {request.method} {request.url}: {errors}")
    return JSONResponse(
        status_code=422,
        content={"detail": errors},
    )

# --- Serve Frontend Static Files ---
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/", tags=["UI"])
def root():
    """Serves the main GateFlow dashboard UI."""
    return FileResponse(FRONTEND_DIR / "index.html")

# --- PWA Support ---
@app.get("/manifest.json", tags=["PWA"], include_in_schema=False)
def get_manifest():
    return FileResponse(FRONTEND_DIR / "manifest.json")

@app.get("/sw.js", tags=["PWA"], include_in_schema=False)
def get_sw():
    return FileResponse(FRONTEND_DIR / "sw.js")

@app.get("/icon.png", tags=["PWA"], include_in_schema=False)
def get_icon():
    return FileResponse(FRONTEND_DIR / "icon.png")

@app.get("/api/info", tags=["System"])
def get_info():
    """Returns server information including the local IP address."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return {"ip": ip, "port": 8000}

# Include Routers
app.include_router(auth.router, prefix="/auth")
app.include_router(logs.router, prefix="/logs")
app.include_router(transits.router)
app.include_router(websockets.router)
