#!/usr/bin/env python3
"""SecurityMonitor — Guvenlik Takip Yazilimi"""
import webbrowser
import threading
import os
import sys
import io

# cp1254 hatasini onlemek icin stdout'u UTF-8'e zorla
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.server import app


def open_browser():
    """Sunucu hazir oldugunda tarayiciyi acar."""
    webbrowser.open("http://127.0.0.1:5050")


def print_banner():
    print("""
+----------------------------------------------+
|        SecurityMonitor v1.0                  |
|     Guvenlik Takip ve Donanim Izleme         |
|                                              |
|  Tum donanim erisimleri KULLANICI IZNINE     |
|  tabidir. Izinler dashboard uzerinden        |
|  yonetilir.                                  |
+----------------------------------------------+
    """)


if __name__ == "__main__":
    print_banner()
    print("  -> Web arayuzu aciliyor...")
    print("  -> http://127.0.0.1:5050")
    print("  -> Cikmak icin Ctrl+C")
    print()

    threading.Timer(1.5, open_browser).start()
    app.run(host="127.0.0.1", port=5050, debug=False)
