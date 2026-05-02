from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
from .models import StatoTransito, TipoOperazione


# ─── REQUEST SCHEMAS ──────────────────────────────────────────────────────────
# NOTE: Do NOT use use_enum_values=True on request models in Pydantic V2.
#       Pydantic V2 natively coerces strings (e.g. "IN_CARICO") to enum members.
#       use_enum_values on Optional[Enum] fields breaks validation in Python 3.12+.

class BaseSchema(BaseModel):
    model_config = {
        "use_enum_values": True,
        "validate_assignment": True,
        "populate_by_name": True,
        "from_attributes": True
    }

class CheckInRequest(BaseSchema):
    targa: str
    vettore: str
    codice_linea: Optional[str] = None
    codice_vred_tme: Optional[str] = None
    cliente: Optional[str] = None
    partenza: Optional[str] = None
    autista: Optional[str] = None
    telefono: Optional[str] = None
    targa_smr: Optional[str] = None
    tipo_operazione: Optional[TipoOperazione] = TipoOperazione.CARICO
    molo: Optional[int] = None
    ddt: Optional[str] = None
    colli: Optional[int] = None
    peso: Optional[int] = None
    bi: Optional[int] = None
    ci: Optional[int] = None
    sacco: Optional[int] = None
    percentuale_sfu: Optional[int] = None
    pe: Optional[int] = None
    rr: Optional[str] = None
    me: Optional[str] = None
    sigillo1: Optional[str] = None
    sigillo2: Optional[str] = None
    note: Optional[str] = None

    @field_validator('targa')
    @classmethod
    def clean_targa(cls, v: str) -> str:
        return v.strip().replace(" ", "").upper()


class UpdateStatusRequest(BaseSchema):
    stato: StatoTransito
    molo: Optional[int] = None


class UpdateTransitoRequest(BaseSchema):
    targa: Optional[str] = None
    vettore: Optional[str] = None
    codice_linea: Optional[str] = None
    codice_vred_tme: Optional[str] = None
    cliente: Optional[str] = None
    partenza: Optional[str] = None
    autista: Optional[str] = None
    telefono: Optional[str] = None
    targa_smr: Optional[str] = None
    tipo_operazione: Optional[TipoOperazione] = None
    molo: Optional[int] = None
    stato: Optional[StatoTransito] = None
    ddt: Optional[str] = None
    colli: Optional[int] = None
    peso: Optional[int] = None
    bi: Optional[int] = None
    ci: Optional[int] = None
    sacco: Optional[int] = None
    percentuale_sfu: Optional[int] = None
    pe: Optional[int] = None
    rr: Optional[str] = None
    me: Optional[str] = None
    sigillo1: Optional[str] = None
    sigillo2: Optional[str] = None
    note: Optional[str] = None

    @field_validator('targa')
    @classmethod
    def clean_targa(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return v.strip().replace(" ", "").upper()
        return v


# ─── RESPONSE SCHEMAS ─────────────────────────────────────────────────────────
# use_enum_values=True here is correct: it ensures JSON responses contain
# plain strings (e.g. "CARICO") rather than enum members.

class TransitoResponse(BaseSchema):
    id: str
    targa: str
    vettore: str
    codice_linea: Optional[str] = None
    codice_vred_tme: Optional[str] = None
    cliente: Optional[str] = None
    partenza: Optional[str] = None
    autista: Optional[str] = None
    telefono: Optional[str] = None
    targa_smr: Optional[str] = None
    tipo_operazione: TipoOperazione
    timestamp_in: datetime
    timestamp_out: Optional[datetime] = None
    molo: Optional[int] = None
    stato: StatoTransito
    ddt: Optional[str] = None
    colli: Optional[int] = None
    peso: Optional[int] = None
    bi: Optional[int] = None
    ci: Optional[int] = None
    sacco: Optional[int] = None
    percentuale_sfu: Optional[int] = None
    pe: Optional[int] = None
    rr: Optional[str] = None
    me: Optional[str] = None
    sigillo1: Optional[str] = None
    sigillo2: Optional[str] = None
    note: Optional[str] = None


# ─── USER SCHEMAS ─────────────────────────────────────────────────────────────

class UserCreate(BaseSchema):
    username: str
    password: str
    role: str
    can_export: Optional[bool] = False
    nome: Optional[str] = None
    matricola: Optional[str] = None


class UserUpdate(BaseSchema):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    can_export: Optional[bool] = None
    nome: Optional[str] = None
    matricola: Optional[str] = None


class UserResponse(BaseSchema):
    id: str
    username: str
    role: str
    can_export: bool
    nome: Optional[str] = None
    matricola: Optional[str] = None

class LogResponse(BaseSchema):
    id: str
    timestamp: datetime
    username: str
    operator_name: Optional[str] = None
    operator_badge: Optional[str] = None
    role: str
    action: str
    details: Optional[str] = None
