import sqlite3
import os

db_path = "logistic.db"

if not os.path.exists(db_path):
    print(f"File {db_path} non trovato.")
else:
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Aggiungi colonne se non esistono
        cursor.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if "nome" not in columns:
            print("Aggiunta colonna 'nome' a tabella 'users'...")
            cursor.execute("ALTER TABLE users ADD COLUMN nome TEXT")
            
        if "matricola" not in columns:
            print("Aggiunta colonna 'matricola' a tabella 'users'...")
            cursor.execute("ALTER TABLE users ADD COLUMN matricola TEXT")
            
        conn.commit()
        conn.close()
        print("Migrazione completata con successo.")
    except Exception as e:
        print(f"Errore durante la migrazione: {e}")
