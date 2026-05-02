import uuid
import enum
from sqlalchemy import Column, String, DateTime, Integer, Enum, func, Boolean
from sqlalchemy.dialects.postgresql import UUID
from .database import Base

class StatoTransito(str, enum.Enum):
    INGRESSO = "INGRESSO"
    IN_CARICO = "IN_CARICO"
    COMPLETATO = "COMPLETATO"
    USCITO = "USCITO"

class TipoOperazione(str, enum.Enum):
    CARICO = "CARICO"
    SCARICO = "SCARICO"
    RESO = "RESO"

class Transito(Base):
    __tablename__ = "transiti"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    targa = Column(String, index=True, nullable=False)
    codice_linea = Column(String, nullable=True)
    codice_vred_tme = Column(String, nullable=True)
    cliente = Column(String, nullable=True)
    partenza = Column(String, nullable=True)
    autista = Column(String, nullable=True)
    telefono = Column(String, nullable=True)
    targa_smr = Column(String, nullable=True)
    vettore = Column(String, nullable=False)
    tipo_operazione = Column(Enum(TipoOperazione), default=TipoOperazione.CARICO)
    ddt = Column(String, nullable=True)
    colli = Column(Integer, nullable=True)
    peso = Column(Integer, nullable=True)
    
    # Spreadsheet-specific numeric fields
    bi = Column(Integer, nullable=True)
    ci = Column(Integer, nullable=True)
    sacco = Column(Integer, nullable=True)
    percentuale_sfu = Column(Integer, nullable=True)
    pe = Column(Integer, nullable=True)
    rr = Column(String, nullable=True) 
    me = Column(String, nullable=True)
    
    sigillo1 = Column(String, nullable=True)
    sigillo2 = Column(String, nullable=True)
    
    note = Column(String, nullable=True)
    timestamp_in = Column(DateTime(timezone=True), server_default=func.now())
    timestamp_out = Column(DateTime(timezone=True), nullable=True)
    molo = Column(Integer, nullable=True)
    stato = Column(Enum(StatoTransito), default=StatoTransito.INGRESSO)

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False) # admin, portineria_in, portineria_out, magazzino
    can_export = Column(Boolean, default=False)
    nome = Column(String, nullable=True)
    matricola = Column(String, nullable=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    timestamp = Column(DateTime(timezone=True), default=func.now())
    username = Column(String, nullable=False)
    operator_name = Column(String, nullable=True)
    operator_badge = Column(String, nullable=True)
    role = Column(String, nullable=False)
    action = Column(String, nullable=False) # e.g., "Check-in", "Delete", "User Created"
    details = Column(String, nullable=True)
