# utils/jwt.py
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from app.config import APP_SECRET_KEY

ALGORITHM = "HS256"
EXPIRE_MINUTES = 60


def create_session_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(minutes=EXPIRE_MINUTES)
    return jwt.encode(payload, APP_SECRET_KEY, algorithm=ALGORITHM)


def decode_session_token(token: str) -> dict:
    try:
        return jwt.decode(token, APP_SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return {}
