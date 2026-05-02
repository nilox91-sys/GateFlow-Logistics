import os
from datetime import datetime, timedelta
from typing import Optional
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import bcrypt
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserUpdate, UserResponse
from ..utils.audit import add_audit_log

router = APIRouter()

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-gateflow")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 giorno

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

class Token(BaseModel):
    access_token: str
    token_type: str

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def create_initial_admin(db: Session):
    """Garantisce l'esistenza dell'utente admin con permessi corretti"""
    admin = db.query(User).filter(User.username == "admin").first()
    if not admin:
        admin_pass = os.getenv("ADMIN_PASSWORD", "logistics2026")
        admin = User(
            username="admin",
            hashed_password=get_password_hash(admin_pass),
            role="admin",
            can_export=True
        )
        db.add(admin)
        db.commit()
        print(" [GateFlow] Utente ADMIN creato con successo (password di default).")
    else:
        # Assicuriamoci che l'admin esistente abbia il permesso di export
        if not admin.can_export or admin.role != "admin":
            admin.can_export = True
            admin.role = "admin"
            db.commit()
            print(" [GateFlow] Permessi utente ADMIN aggiornati.")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return {
        "username": user.username, 
        "role": user.role, 
        "id": user.id, 
        "can_export": user.can_export,
        "nome": user.nome,
        "matricola": user.matricola
    }

def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Permesso negato: solo amministratori.")
    return current_user

def require_admin_or_responsabile(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "responsabile"]:
        raise HTTPException(status_code=403, detail="Permesso negato.")
    return current_user

@router.post("/token", response_model=Token, tags=["Auth"])
async def login_for_access_token(db: Session = Depends(get_db), form_data: OAuth2PasswordRequestForm = Depends()):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.username, 
            "role": user.role, 
            "can_export": user.can_export,
            "nome": user.nome,
            "matricola": user.matricola
        }, 
        expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# ─── GESTIONE UTENTI (ADMIN ONLY) ──────────────────────

@router.get("/users", response_model=List[UserResponse], tags=["Admin"])
def list_users(db: Session = Depends(get_db), auth_user: dict = Depends(require_admin_or_responsabile)):
    return db.query(User).all()

@router.post("/users", response_model=UserResponse, tags=["Admin"])
def create_user(payload: UserCreate, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username già esistente")
    
    nuovo = User(
        username=payload.username,
        role=payload.role,
        can_export=payload.can_export,
        nome=payload.nome,
        matricola=payload.matricola,
        hashed_password=get_password_hash(payload.password)
    )
    db.add(nuovo)
    db.commit()
    db.refresh(nuovo)
    
    add_audit_log(db, admin, "Nuovo Utente", f"Creato utente {nuovo.username} con ruolo {nuovo.role}")
    return nuovo

@router.patch("/users/{user_id}", response_model=UserResponse, tags=["Admin"])
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db), auth_user: dict = Depends(require_admin_or_responsabile)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    if auth_user["role"] == "responsabile":
        if user.role == "admin":
            raise HTTPException(status_code=403, detail="Un responsabile non può modificare un amministratore.")
        # Il responsabile può cambiare SOLO la password
        if payload.username or payload.role or payload.can_export is not None:
             raise HTTPException(status_code=403, detail="Un responsabile può aggiornare solo la password degli operatori.")

    if payload.username:
        user.username = payload.username
    if payload.role:
        user.role = payload.role
    if payload.can_export is not None:
        user.can_export = payload.can_export
    if payload.nome is not None:
        user.nome = payload.nome
    if payload.matricola is not None:
        user.matricola = payload.matricola
    if payload.password:
        user.hashed_password = get_password_hash(payload.password)
    
    db.commit()
    db.refresh(user)

    add_audit_log(db, auth_user, "Modifica Utente", f"Aggiornato profilo per {user.username}")
    return user

@router.delete("/users/{user_id}", tags=["Admin"])
def delete_user(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    if user.username == "admin":
        raise HTTPException(status_code=400, detail="Impossibile cancellare l'admin principale")
    
    add_audit_log(db, admin, "Eliminazione Utente", f"Cancellato utente {user.username}")
    db.delete(user)
    db.commit()
    return {"message": "Utente eliminato"}

@router.patch("/me/password", tags=["Auth"])
def update_my_password(payload: UserUpdate, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if not payload.password:
        raise HTTPException(status_code=400, detail="Password richiesta")
    
    user = db.query(User).filter(User.username == current_user["username"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    user.hashed_password = get_password_hash(payload.password)
    db.commit()
    return {"message": "Password aggiornata con successo"}
