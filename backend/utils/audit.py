from sqlalchemy.orm import Session
from ..models import AuditLog

def add_audit_log(db: Session, user: dict, action: str, details: str = ""):
    """Helper per inserire un log di sistema"""
    log_entry = AuditLog(
        username=user["username"],
        operator_name=user.get("nome"),
        operator_badge=user.get("matricola"),
        role=user["role"],
        action=action,
        details=details
    )
    db.add(log_entry)
    db.commit()
