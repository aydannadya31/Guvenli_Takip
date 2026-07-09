"""WSGI entry point for gunicorn (Render deployment)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.server import app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5050)), debug=False)
