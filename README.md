# 🚛 GateFlow — Logistics Hub Control Center

[![Status: Production Ready](https://img.shields.io/badge/Status-Production--Ready-success.svg?style=flat-square)](#)
[![Version: 1.3.0](https://img.shields.io/badge/Version-1.3.0-blue.svg?style=flat-square)](#)
[![Python](https://img.shields.io/badge/Python-3.11+-3776ab.svg?style=flat-square&logo=python&logoColor=white)](#)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688.svg?style=flat-square&logo=fastapi&logoColor=white)](#)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed.svg?style=flat-square&logo=docker&logoColor=white)](#)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg?style=flat-square)](#)

**GateFlow** is a next-generation enterprise platform for full control of logistics flows at sorting hubs and distribution centres. Built with a **Performance-First** philosophy, GateFlow digitises the entire lifecycle of a transit: from gate check-in all the way through to dock departure.

---

## 📑 Table of Contents

- [Features](#-enterprise-features)
- [Tech Stack](#️-tech-stack)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
- [Production Checklist](#-production-security-checklist)
- [Recommended Hardware](#-recommended-hardware)
- [Documentation](#-documentation)

---

## 🌟 Enterprise Features

| Feature | Description |
|---|---|
| **Real-Time Dashboard** | Instant sync between Gate and Warehouse via WebSockets — zero polling, zero latency. |
| **RBAC 2.0 Security** | Granular role-based access control. Supervisors can reset operator passwords in real time. |
| **Advanced Audit Log** | Full traceability of every change, with operator identification via role badge (Name + Badge ID). |
| **High-Performance PWA** | Interface optimised for industrial tablets (Zebra, Honeywell) with native app installation support. |
| **KPI Engine** | Automatic analysis of vehicles waiting, vehicles loading, and overdue alerts (> 2 hours on-site). |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.11+, **FastAPI** (async), Uvicorn |
| **ORM / Database** | SQLAlchemy ORM + SQLite (PostgreSQL-ready) |
| **Authentication** | OAuth2 Bearer Token (JWT), bcrypt password hashing |
| **Frontend** | Vanilla JS (ES6+), CSS3 Glassmorphism, HTML5 Semantic |
| **Real-Time** | WebSockets (native FastAPI) |
| **PWA** | Service Worker (`sw.js`), Web App Manifest |
| **Infrastructure** | Docker & Docker Compose |

---

## 📁 Project Structure

```
gateflow/
├── backend/
│   ├── main.py              # FastAPI app entry point, CORS, static files
│   ├── models.py            # SQLAlchemy ORM models (User, Transit, AuditLog)
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── database.py          # DB engine & session factory
│   ├── archiver.py          # Automated transit archiving logic
│   ├── logger_config.py     # Structured logging configuration
│   └── routers/
│       ├── auth.py          # Login, JWT, user management, password reset
│       ├── transits.py      # Full CRUD for transit lifecycle
│       ├── logs.py          # Audit log query endpoints
│       └── websockets.py    # Real-time WebSocket broadcast manager
├── frontend/
│   ├── index.html           # Single-page application shell
│   ├── app.js               # All UI logic, WebSocket client, role rendering
│   ├── style.css            # Glassmorphism design system
│   ├── manifest.json        # PWA manifest
│   └── sw.js                # Service Worker for offline caching
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── run.py                   # Local dev server launcher
└── seed_demo.py             # Demo data seeder
```

---

## 🚀 Quick Start

### With Docker (Recommended)

```bash
# 1. Clone the repository
git clone <repo-url>
cd gateflow

# 2. Build and start the containers
docker-compose up -d --build

# 3. Open the Control Center in your browser
# http://localhost:8000
```

Default admin credentials (change immediately in production):
- **Username**: `admin`
- **Password**: `logistics2026`

### Without Docker (Local Development)

```bash
# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate      # Linux/macOS
venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Seed demo data (optional)
python seed_demo.py

# Start the server
python run.py
# → http://localhost:8000
```

---

## ✅ Production Security Checklist

- [ ] **Change the admin password** — replace `logistics2026` on first launch.
- [ ] **Static IP** — assign a static LAN IP to the server to prevent tablet disconnections.
- [ ] **Firewall** — expose only port `8000` on the local network; block all external access.
- [ ] **HTTPS** — for public or WAN access, set up an Nginx reverse proxy with an SSL certificate.
- [ ] **Backup** — schedule a nightly cron job to copy `logistic.db` to a safe location (see [Production Guide](TUTORIAL_PRODUZIONE.md)).

---

## 🔧 Recommended Hardware

| Station | Recommended Device |
|---|---|
| **Server** | Any PC with 4 GB+ RAM (Ubuntu Server LTS preferred) |
| **Gate Office** | 24" desktop monitor or laptop |
| **Warehouse / Yard** | 10" rugged tablet with protective case (iPad or Samsung Tab Active) |
| **Barcode Scanner** | Any USB/Bluetooth keyboard-wedge scanner (optional) |

---

## 📄 Documentation

- [**Technical Report**](RELAZIONE_TECNICA.md) — Architecture details, data model, and troubleshooting.
- [**Production Guide**](TUTORIAL_PRODUZIONE.md) — Step-by-step setup for a real multi-building logistics hub.

---

*GateFlow — Excellence in Logistics · v1.3.0 · May 2026*
