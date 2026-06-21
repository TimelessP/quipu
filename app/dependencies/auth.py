# dependencies/auth.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from app.utils.jwt import decode_session_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/google/login")

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    payload = decode_session_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session"
        )
    return payload
