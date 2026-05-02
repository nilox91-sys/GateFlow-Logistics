from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models import AuditLog, User
from ..schemas import LogResponse
from .auth import get_current_user, require_admin_or_responsabile

router = APIRouter()

@router.get("", response_model=List[LogResponse], tags=["Admin"])
def get_audit_logs(db: Session = Depends(get_db), current_user: dict = Depends(require_admin_or_responsabile)):
    # Restituisce gli ultimi 200 log
    return db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(200).all()

from ..utils.audit import add_audit_log
