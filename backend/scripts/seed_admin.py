"""One-time seed of the initial admin account. Safe to re-run - does nothing
if any user already exists, so it won't reset a password that's since been
changed. Run with the backend venv active:

    python scripts/seed_admin.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import hash_password
from app.db import SessionLocal
from app.models import User

ADMIN_USERNAME = "spicetown_admin"
ADMIN_PASSWORD = "Levelup2027"


def main() -> None:
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            print("Users already exist - not touching anything. Exiting.")
            return

        user = User(
            username=ADMIN_USERNAME,
            password_hash=hash_password(ADMIN_PASSWORD),
            is_admin=True,
        )
        db.add(user)
        db.commit()
        print(f"Created admin user '{ADMIN_USERNAME}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
