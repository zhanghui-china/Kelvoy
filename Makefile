.PHONY: install web-api web-app worker inference cli test lint typecheck

install:
	bun install
	cd services/inference && uv sync

web-api:
	bun run --cwd apps/web dev:api

web-app:
	bun run --cwd apps/web dev:web

worker:
	bun run --cwd apps/worker dev

inference:
	cd services/inference && uv run python -m inference

typecheck:
	bun run typecheck

test:
	bun test
	cd services/inference && uv run pytest

lint:
	cd services/inference && uv run ruff check .
