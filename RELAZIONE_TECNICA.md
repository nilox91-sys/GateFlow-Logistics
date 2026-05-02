# 📘 GateFlow — Technical Report

> **Version:** 1.3.0 · **Revision:** May 2026

---

## Table of Contents

1. [Functional Analysis](#1-functional-analysis)
2. [Software Architecture](#2-software-architecture)
   - [Backend (Python Ecosystem)](#21-backend-python-ecosystem)
   - [Frontend (Logistics UI)](#22-frontend-logistics-ui)
3. [Data Model](#3-data-model)
4. [Troubleshooting](#4-troubleshooting)
5. [Roadmap](#5-roadmap)

---

## 1. Functional Analysis

**GateFlow** solves the **"blind visibility" problem** between the gate office (which receives incoming vehicles) and the warehouse (which must load them). By automating the exchange of information between the two stations in real time, the system delivers:

- **~30% reduction in idle time** — operators no longer rely on radio calls or manual transcription.
- **Zero transcription errors** — all data entry is validated at the API layer before hitting the database.
- **Full traceability** — every status change is recorded in the audit log with the operator's identity (name + badge ID).

---

## 2. Software Architecture

### 2.1 Backend (Python Ecosystem)

The backend is built on the **FastAPI** framework and follows an **async-first** design pattern.

| Component | Role |
|---|---|
| **FastAPI** | Handles all REST API routes and WebSocket connections. Uses `pydantic` v2 for strict request/response validation — no dirty data ever reaches the database. |
| **SQLAlchemy ORM** | Provides a database abstraction layer. Switching from SQLite to PostgreSQL or MySQL only requires changing a single configuration line (`DATABASE_URL`). |
| **JWT Authentication** | Implements the OAuth2 Bearer Token standard. Passwords are stored as **bcrypt hashes** (one-way, non-reversible). |
| **WebSocket Manager** | A central broadcast manager (`websockets.py`) pushes real-time events to all connected clients whenever a transit is created, updated, or archived. |
| **Archiver** | `archiver.py` automates the archiving of completed transits to keep the active table lean and fast. |
| **Structured Logging** | `logger_config.py` configures a rotating file logger (`gateflow.log`) for production-level observability. |

**Router breakdown:**

```
routers/
├── auth.py       — Login, JWT generation, user CRUD, password reset
├── transits.py   — Full transit lifecycle: check-in → loading → departure
├── logs.py       — Audit log query & filtering endpoints
└── websockets.py — Real-time event broadcast to all connected clients
```

### 2.2 Frontend (Logistics UI)

The frontend is a **Single-Page Application (SPA)** built with Vanilla JS — no framework overhead.

| Feature | Implementation |
|---|---|
| **Zero-Reload UI** | The page never refreshes. WebSocket messages trigger targeted DOM updates — only the affected table row or KPI widget is re-rendered. |
| **PWA / Service Worker** | `sw.js` caches all static assets (CSS, JS, images) on first visit. Subsequent loads are near-instant, even on slow warehouse Wi-Fi. |
| **Role-Based Rendering** | The JS layer reads the JWT claims and dynamically shows or hides UI elements (e.g., admin-only buttons) without any server round-trip. |
| **Glassmorphism Design** | `style.css` implements a modern dark glassmorphism design system optimised for readability under harsh warehouse lighting. |

---

## 3. Data Model

### `User`

| Field | Type | Description |
|---|---|---|
| `id` | Integer (PK) | Auto-incremented primary key |
| `username` | String (unique) | Login username |
| `hashed_password` | String | bcrypt hash — never stored as plaintext |
| `nome` | String | Full name of the operator |
| `matricola` | String | Employee badge ID |
| `role` | Enum | `admin` / `responsabile` / `operatore` |
| `can_export` | Boolean | Whether the user can export data to CSV/PDF |

### `Transit`

| Field | Type | Description |
|---|---|---|
| `id` | Integer (PK) | Auto-incremented primary key |
| `targa` | String | Truck licence plate |
| `targa_rimorchio` | String | Trailer licence plate |
| `vettore` | String | Carrier / transport company |
| `linea` | String | Logistics line code |
| `vred` | String | Reduced vehicle code |
| `cliente` | String | Client name |
| `partenza` | String | Destination / departure hub |
| `operazione` | String | Operation type (e.g., loading, unloading) |
| `molo` | String | Dock number |
| `stato` | Enum | `in_attesa` / `in_carico` / `partito` |
| `note` | Text | Free-text notes |
| `ddt` | String | Delivery note number (Documento di Trasporto) |
| `colli` | Integer | Number of parcels/packages |
| `peso` | Float | Total weight (kg) |
| `sfu` / `pe` / `rr` / `me` / `sacco` / `bi` / `ci` | Boolean | Logistics flags (special handling codes) |
| `sigillo1` / `sigillo2` | String | Seal numbers |
| `timestamp_in` | DateTime | Check-in timestamp (auto-set) |
| `timestamp_out` | DateTime | Departure timestamp (auto-set) |

---

## 4. Troubleshooting

### The system won't start

```bash
# Check that Docker is running
docker ps

# Inspect backend container logs
docker-compose logs -f backend
```

Common cause: port `8000` is already in use by another process. Stop the conflicting service or change the port in `docker-compose.yml`.

---

### Tablets are not receiving real-time updates

1. Verify the tablet is on the **same Wi-Fi network** as the server.
2. Check whether the server's IP address has changed — always use a **static IP** in production.
3. Open the browser console on the tablet and look for WebSocket connection errors.

---

### Login fails

- Ensure the **server clock and tablet clock are synchronised**. JWT validation fails if the clocks differ by more than a few minutes (JWT `exp` claim check).
- On Linux servers, enable NTP: `timedatectl set-ntp true`.

---

### Data appears stale after reconnection

The Service Worker may be serving a cached version of the frontend. To force a full refresh:
- On Chrome: **DevTools → Application → Storage → Clear site data**.
- Or open the app in an incognito window to bypass the cache.

---

## 5. Roadmap

| Priority | Feature | Description |
|---|---|---|
| 🔴 High | **OCR Licence Plate Recognition** | Automatic plate reading via gate camera, eliminating manual entry at check-in. |
| 🟡 Medium | **Driver Self-Service Kiosk** | Outdoor kiosk where the driver can enter their own data autonomously. |
| 🟢 Low | **Advanced Analytics Dashboard** | Statistical reporting for hub hourly productivity, average dwell time, and carrier performance. |
| 🟢 Low | **PostgreSQL Migration** | Production-grade database backend for high-concurrency environments. |

---

*GateFlow — Efficiency in Motion · v1.3.0 · May 2026*
