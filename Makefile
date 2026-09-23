.PHONY: api web test bridge lint

api:
	uv run python -m kelvoy

web:
	cd web && npm run dev

test:
	uv run pytest tests/ -q

lint:
	uv run ruff check .

bridge:
	cd dgx-bridge && uv run python dgx_bridge_service.py
