"""GET /api/v1/health."""

import logging
import sqlite3

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app import database
from app.deps import get_db
from app.schemas import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "Database unavailable"}},
)
def health(request: Request, conn: sqlite3.Connection = Depends(get_db)):
    # `status` is backend + database availability. `components` adds the camera,
    # AI engine and tracker as last reported by the Vision server's heartbeats.
    components = request.app.state.cameras.components()
    try:
        database.ping(conn)
    except sqlite3.Error:
        logger.exception("Health check failed")
        components.database = "offline"
        return JSONResponse(
            status_code=503, content={"status": "unhealthy", "components": components.model_dump()}
        )
    components.database = "online"
    return HealthResponse(status="healthy", components=components)
