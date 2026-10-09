"""Tests explicitly allow inherited local development backends."""
import pytest


@pytest.fixture(autouse=True)
def local_backend_allowlist(monkeypatch):
    monkeypatch.setenv(
        "KELVOY_BACKEND_ALLOWED_ORIGINS", "http://127.0.0.1:8188,http://127.0.0.1:5099"
    )
