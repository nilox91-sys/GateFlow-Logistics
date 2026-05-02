import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.main import app
from backend.database import Base, get_db
from backend.models import StatoTransito

# Use an in-memory SQLite database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture(autouse=True)
def run_around_tests():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

def test_root():
    response = client.get("/")
    assert response.status_code == 200

def test_login():
    response = client.post(
        "/auth/token",
        data={"username": "admin", "password": "logistics2026"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()
    return response.json()["access_token"]

def test_check_in():
    token = test_login()
    response = client.post(
        "/check-in",
        json={"targa": "TEST123A", "vettore": "DHL", "molo": 1},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["targa"] == "TEST123A"
    assert data["stato"] == "INGRESSO"

def test_state_validation():
    token = test_login()
    # Check-in
    res = client.post(
        "/check-in",
        json={"targa": "FAIL123", "vettore": "BRT"},
        headers={"Authorization": f"Bearer {token}"}
    )
    transito_id = res.json()["id"]

    # Try invalid transition INGRESSO -> USCITO
    res2 = client.patch(
        f"/update-status/{transito_id}",
        json={"stato": "USCITO"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res2.status_code == 400
    
    # Valid transition to IN_CARICO -> COMPLETATO -> USCITO
    client.patch(
        f"/update-status/{transito_id}",
        json={"stato": "IN_CARICO"},
        headers={"Authorization": f"Bearer {token}"}
    )
    client.patch(
        f"/update-status/{transito_id}",
        json={"stato": "COMPLETATO"},
        headers={"Authorization": f"Bearer {token}"}
    )

    res3 = client.post(
        f"/check-out/{transito_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res3.status_code == 200
    assert res3.json()["stato"] == "USCITO"
