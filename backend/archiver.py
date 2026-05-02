"""
archiver.py - Nightly archiving script.

Usage: python -m backend.archiver
Schedule with Windows Task Scheduler or a cron job to run nightly (e.g., 02:00).

This script:
1. Queries all USCITO records from the `transiti` table.
2. Exports them to a timestamped CSV file in the `./archives/` directory.
3. Purges those records from the live table to keep performance high.
"""
import csv
import os
from datetime import datetime
from sqlalchemy.orm import Session
from .database import SessionLocal, engine
from .models import Transito, StatoTransito, Base

from .logger_config import logger

ARCHIVE_DIR = os.path.join(os.path.dirname(__file__), "..", "archives")


def run_archiving():
    Base.metadata.create_all(bind=engine)
    os.makedirs(ARCHIVE_DIR, exist_ok=True)

    db: Session = SessionLocal()
    try:
        records = (
            db.query(Transito)
            .filter(Transito.stato == StatoTransito.USCITO)
            .all()
        )

        if not records:
            logger.info("Nessun record da archiviare.")
            return

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = os.path.join(ARCHIVE_DIR, f"archivio_{timestamp_str}.csv")

        fieldnames = ["id", "targa", "vettore", "timestamp_in", "timestamp_out", "molo", "stato"]
        with open(filename, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for r in records:
                writer.writerow({
                    "id": r.id,
                    "targa": r.targa,
                    "vettore": r.vettore,
                    "timestamp_in": r.timestamp_in.isoformat() if r.timestamp_in else "",
                    "timestamp_out": r.timestamp_out.isoformat() if r.timestamp_out else "",
                    "molo": r.molo,
                    "stato": r.stato.value if r.stato else "",
                })

        count = len(records)
        for r in records:
            db.delete(r)
        db.commit()

        logger.info(f"Archiviati {count} record in '{filename}'.")

    finally:
        db.close()


if __name__ == "__main__":
    run_archiving()
