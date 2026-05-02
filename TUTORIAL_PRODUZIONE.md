# 🚀 GateFlow — Production Deployment Guide

This guide covers the complete installation and configuration of **GateFlow** in a real logistics hub environment with physically separate buildings (e.g., gate office and warehouse on opposite ends of the yard).

---

## Table of Contents

1. [Network Infrastructure Setup](#1-network-infrastructure-setup)
2. [Server Installation](#2-server-installation)
3. [PWA Installation on Tablets](#3-pwa-installation-on-tablets)
4. [User & Role Management](#4-user--role-management)
5. [Emergency: Password Reset](#5-emergency-password-reset)
6. [Automated Backups](#6-automated-backups)
7. [Multi-Building Topology](#7-multi-building-topology)
8. [Updating GateFlow](#8-updating-gateflow)

---

## 1. Network Infrastructure Setup

### 1.1 Static IP for the Server

The GateFlow server **must** have a static LAN IP. Without it, tablets will lose their connection every time the router reassigns the server's address.

**Recommended approach (Linux/Ubuntu Server):**

Edit `/etc/netplan/00-installer-config.yaml`:

```yaml
network:
  ethernets:
    eth0:
      dhcp4: no
      addresses: [192.168.1.100/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
  version: 2
```

```bash
sudo netplan apply
```

All tablets will then access the platform at: **`http://192.168.1.100:8000`**

---

### 1.2 Wi-Fi Coverage in the Yard

For uninterrupted check-in operations across the yard:

- Use **industrial-grade access points** (recommended: UniFi, TP-Link Omada).
- Create a dedicated network named `GateFlow-Logistics` (or similar) reserved exclusively for GateFlow devices.
- Avoid consumer-grade routers — they often drop long-lived WebSocket connections.

---

## 2. Server Installation

### Prerequisites

- Docker ≥ 24.x
- Docker Compose ≥ 2.x
- At least **4 GB RAM** and **10 GB free disk space**

### Steps

```bash
# 1. Clone the repository onto the server
git clone <repo-url>
cd gateflow

# 2. (Optional) Seed demo data for initial testing
python seed_demo.py

# 3. Build and start in detached mode
docker-compose up -d --build

# 4. Verify the containers are running
docker-compose ps
```

The application will be available at **`http://<SERVER-IP>:8000`**.

To watch live logs:

```bash
docker-compose logs -f backend
```

---

## 3. PWA Installation on Tablets

GateFlow is a **Progressive Web App (PWA)**. Installing it gives operators a full-screen, app-like experience without needing the Play Store or App Store.

### Android (Chrome)

1. Open **Chrome** on the tablet.
2. Navigate to `http://<SERVER-IP>:8000`.
3. Tap the **three-dot menu** → **"Add to Home Screen"**.
4. Confirm the name (e.g., `GateFlow`) and tap **Add**.

### iOS (Safari)

1. Open **Safari** on the iPad.
2. Navigate to `http://<SERVER-IP>:8000`.
3. Tap the **Share** button (box with an arrow) → **"Add to Home Screen"**.
4. Tap **Add**.

The GateFlow icon will appear on the tablet's home screen. Opening it launches the app in full-screen mode with no browser chrome.

> [!NOTE]
> After installation, the Service Worker caches all static assets. The interface loads instantly on subsequent visits, even on slow Wi-Fi.

---

## 4. User & Role Management

GateFlow has three built-in roles:

| Role | Capabilities |
|---|---|
| `admin` | Full access — manage users, view all logs, reset any password, export data. |
| `responsabile` | Supervisor — can reset operator passwords, view audit logs. |
| `operatore` | Warehouse/Gate operator — can manage transits only. |

To create a new user, log in as **admin** and navigate to **Settings → User Management → New User**.

> [!IMPORTANT]
> Change the default admin password (`logistics2026`) immediately on first deployment.

---

## 5. Emergency: Password Reset

If an operator is locked out of their account:

1. Log in as a **Supervisor** (`responsabile`) or **Admin**.
2. Navigate to the **"Personnel Registry"** tab in Settings.
3. Select the locked operator from the list.
4. Enter a temporary new password and click **Save**.
5. Communicate the temporary password to the operator securely.
6. The operator should change their own password after logging in.

> [!TIP]
> Advise operators to keep their badge ID close at hand — it is required alongside their password for login.

---

## 6. Automated Backups

Because GateFlow uses SQLite, the entire database is a **single file** (`logistic.db`). This makes backups trivially simple.

### Linux — Daily Cron Job

```bash
#!/bin/bash
# /usr/local/bin/gateflow-backup.sh
# Run daily via cron: 0 2 * * * /usr/local/bin/gateflow-backup.sh

BACKUP_DIR="/mnt/nas/gateflow-backups"   # ← Change to your backup destination
DB_PATH="/opt/gateflow/logistic.db"
DATE=$(date +%Y-%m-%d)

mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_DIR/gateflow_backup_$DATE.db"

# Optional: keep only the last 30 days
find "$BACKUP_DIR" -name "*.db" -mtime +30 -delete

echo "✅ Backup completed: gateflow_backup_$DATE.db"
```

Add it to crontab (`crontab -e`):

```
0 2 * * * /usr/local/bin/gateflow-backup.sh
```

This runs every night at 2:00 AM and stores a daily snapshot.

### Windows — Task Scheduler

```powershell
# Run in PowerShell as Administrator
$src = "C:\gateflow\logistic.db"
$dst = "D:\Backups\gateflow_backup_$(Get-Date -Format 'yyyy-MM-dd').db"
Copy-Item $src $dst
```

Schedule this script with **Windows Task Scheduler** to run nightly.

---

## 7. Multi-Building Topology

GateFlow is designed to work across physically separate buildings with no additional hardware, provided they share the same LAN.

```
                        ┌─────────────────────┐
                        │   GateFlow Server   │
                        │  (Warehouse Office) │
                        │  IP: 192.168.1.100  │
                        └────────┬────────────┘
                                 │
                    ─────────────────────────────
                    │ LAN (Ethernet / Fibre / Radio)
          ┌─────────┴──────────┐         ┌──────────────────┐
          │   Gate Office PC   │         │  Yard Tablets    │
          │  Chrome Browser    │         │  PWA (full-screen)│
          │  192.168.1.x       │         │  Wi-Fi 5 GHz     │
          └────────────────────┘         └──────────────────┘
```

- The server can be located in either building — anywhere on the LAN.
- The gate office uses a standard PC browser (Chrome/Firefox/Edge).
- Yard tablets connect over Wi-Fi.
- If buildings are more than 100 m apart, use **fibre optic** or a **wireless bridge** (e.g., Ubiquiti AirMax) to extend the LAN.

No VPN or port forwarding is required for a single-site deployment.

---

## 8. Updating GateFlow

```bash
# Pull the latest changes from the repository
git pull origin main

# Rebuild and restart the containers (zero-downtime if using rolling updates)
docker-compose up -d --build

# Verify the update
docker-compose ps
docker-compose logs -f backend
```

> [!WARNING]
> If the update includes database schema changes, run any migration scripts **before** restarting the containers. Check the release notes for migration instructions.

---

*GateFlow — Excellence in Logistics · v1.3.0 · May 2026*
