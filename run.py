"""
run.py — Quick launcher for the SDA Logistics backend.

Usage:
    python run.py

This starts Uvicorn with hot-reload for development.
"""
import uvicorn
import socket

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

if __name__ == "__main__":
    local_ip = get_ip()
    print("\n" + "="*50)
    print("🚀 GATEFLOW LOGISTICS SYSTEM")
    print("="*50)
    print(f"L'applicazione è pronta per essere testata!")
    print(f"\nPC Locale:     http://localhost:8000")
    print(f"Altri Dispositivi: http://{local_ip}:8000")
    print("="*50 + "\n")

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
