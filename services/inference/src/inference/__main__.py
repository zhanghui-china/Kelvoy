"""Entry point for the persistent inference service."""

import uvicorn

from inference.app import app
from inference.config import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
