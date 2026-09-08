from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import structlog

from app.core.auth import verify_password, create_access_token, get_current_user
from app.db.database import get_db

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str
    full_name: str


class MeResponse(BaseModel):
    user_id: str
    username: str
    email: str
    full_name: str
    role: str


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db=Depends(get_db)):
    user = await db.users.find_one({"username": req.username})
    if not user or not verify_password(req.password, user["hashed_password"]):
        logger.warning("Failed login attempt", username=req.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.get("is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token = create_access_token(user["user_id"], user["role"])
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"last_login": datetime.utcnow()}},
    )
    logger.info("User logged in", username=req.username, role=user["role"])
    return LoginResponse(
        access_token=token,
        user_id=user["user_id"],
        username=user["username"],
        role=user["role"],
        full_name=user["full_name"],
    )


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return MeResponse(
        user_id=current_user["user_id"],
        username=current_user["username"],
        email=current_user["email"],
        full_name=current_user["full_name"],
        role=current_user["role"],
    )


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    logger.info("User logged out", username=current_user["username"])
    return {"message": "Logged out successfully"}
