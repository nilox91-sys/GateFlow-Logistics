import sys
import os
from datetime import datetime, timedelta
import uuid

# Aggiunge la cartella corrente al path per importare il backend
sys.path.append(os.getcwd())

from backend.database import SessionLocal, engine
from backend.models import Transito, StatoTransito, TipoOperazione, Base

def seed():
    print("--- Pulizia database (transiti di oggi) ---")
    db = SessionLocal()
    
    # Rimuove i transiti di oggi (o tutti per il seed demo)
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    db.query(Transito).filter(Transito.timestamp_in >= today_start).delete()
    db.commit()

    print("--- Popolamento nuovi dati demo (Executive) ---")
    
    now = datetime.now()

    demo_data = [
        # MEZZI OLTRE SOGLIA (Critical - Warning RossI)
        {
            "targa": "EB 123 AA",
            "vettore": "FERRARI LOGISTICA",
            "codice_linea": "AMA301",
            "cliente": "MXP5 - CASTEL S.G.",
            "stato": StatoTransito.INGRESSO,
            "tipo_operazione": TipoOperazione.SCARICO,
            "molo": 12,
            "timestamp_in": now - timedelta(hours=3, minutes=15),
            "note": "Documenti SMR non conformi, attesa ufficio"
        },
        {
            "targa": "CD 456 BB",
            "vettore": "SDA EXPRESS",
            "codice_linea": "AMA412",
            "codice_vred_tme": "225B99XY",
            "cliente": "BLQ1 - BOLOGNA",
            "stato": StatoTransito.IN_CARICO,
            "tipo_operazione": TipoOperazione.CARICO,
            "molo": 5,
            "timestamp_in": now - timedelta(hours=2, minutes=40),
            "note": "Carico parziale, manca pedana SFU"
        },
        
        # MEZZI IN GESTIONE (Regular - Warning Giallo/Verde)
        {
            "targa": "GH 555 YY",
            "vettore": "SDA LINEA",
            "codice_linea": "SDA101",
            "cliente": "ROMA HUB",
            "stato": StatoTransito.IN_CARICO,
            "tipo_operazione": TipoOperazione.SCARICO,
            "molo": 8,
            "timestamp_in": now - timedelta(minutes=55),
        },
        {
            "targa": "FR 987 XX",
            "vettore": "BARTOLINI",
            "codice_linea": "LIN110",
            "cliente": "HUB PIACENZA",
            "stato": StatoTransito.INGRESSO,
            "tipo_operazione": TipoOperazione.CARICO,
            "molo": 2,
            "timestamp_in": now - timedelta(minutes=45),
            "note": "Autista in pausa pranzo"
        },
        
        # MEZZI APPENA ENTRATI (Fresh)
        {
            "targa": "KL 222 ZZ",
            "vettore": "TNT TRUCKS",
            "codice_linea": "TNT55",
            "cliente": "MILANO EST",
            "stato": StatoTransito.INGRESSO,
            "tipo_operazione": TipoOperazione.CARICO,
            "molo": 15,
            "timestamp_in": now - timedelta(minutes=12),
        },
        {
            "targa": "ZA 000 BB",
            "vettore": "POSTE ITALIANE",
            "codice_linea": "POS10",
            "cliente": "SDA HUB",
            "stato": StatoTransito.INGRESSO,
            "tipo_operazione": TipoOperazione.SCARICO,
            "molo": 1,
            "timestamp_in": now - timedelta(minutes=4),
        },
        
        # MEZZO COMPLETATO (Pronto per Check-out)
        {
            "targa": "TR 777 OK",
            "vettore": "LOGISTICA 4.0",
            "codice_linea": "EXP99",
            "cliente": "NAPOLI INTERPORTO",
            "stato": StatoTransito.COMPLETATO,
            "tipo_operazione": TipoOperazione.CARICO,
            "molo": 22,
            "timestamp_in": now - timedelta(hours=1, minutes=45),
            "note": "Carico terminato, sigilli applicati"
        }
    ]

    for data in demo_data:
        t = Transito(
            id=str(uuid.uuid4()),
            **data
        )
        db.add(t)
    
    db.commit()
    db.close()
    print("DONE: Database resettato e popolato con successo per la demo!")

if __name__ == "__main__":
    seed()
