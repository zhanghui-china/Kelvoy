"""Entry point for the persistent inference service."""

import logging

import uvicorn

from inference.app import app
from inference.config import Settings


def main() -> None:
    settings = Settings()
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("inference").setLevel(logging.INFO)
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
