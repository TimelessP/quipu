# routers/google_auth.py
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from urllib.parse import urlencode
from app.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
from app.utils.jwt import create_session_token  # your own JWT utility

router = APIRouter(prefix="/auth/google", tags=["auth"])

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO  = "https://www.googleapis.com/oauth2/v2/userinfo"


@router.get("/login")
async def google_login():
    """Redirect the user to Google's OAuth consent page."""
    params = {
        "response_type": "code",
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "scope":         "openid email profile",
        "access_type":   "offline",   # omit if you don't need refresh tokens
        "prompt":        "consent",
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/callback")
async def google_callback(code: str):
    """Google redirects here with an authorisation code."""
    async with httpx.AsyncClient() as client:

        # 1. Exchange code for tokens
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  GOOGLE_REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
        token_data = token_resp.json()
        access_token = token_data.get("access_token")

        if not access_token:
            raise HTTPException(status_code=400, detail="Token exchange failed")

        # 2. Fetch user profile from Google
        user_resp = await client.get(
            GOOGLE_USERINFO,
            headers={"Authorization": f"Bearer {access_token}"}
        )
        user_info = user_resp.json()

    # 3. Upsert user in your own DB here
    #    user_info contains: id, email, name, picture, verified_email
    email = user_info.get("email")
    # ... your DB upsert logic ...

    # 4. Issue your own session JWT
    session_token = create_session_token({"sub": email, "name": user_info.get("name")})

    # 5. Return token — or redirect with it set as a cookie
    return {"access_token": session_token, "token_type": "bearer"}
