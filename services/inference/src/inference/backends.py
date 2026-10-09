"""Shared target resolution for generation and read-only diagnostics."""
from urllib.parse import unquote, urlsplit

from inference.config import Settings


def normalize_backend_url(value: str) -> str:
    if (not value or value != value.strip() or any(c.isspace() for c in value)
            or any(c in value for c in ('\\', '?', '#'))):
        raise ValueError('backend URL must not contain whitespace, queries or fragments')
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError('invalid backend URL') from exc
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username is not None or parsed.password is not None):
        raise ValueError('backend URL requires HTTP/HTTPS without credentials')
    decoded = unquote(parsed.path)
    if ('\\' in decoded or any(part in ('.', '..') for part in decoded.split('/'))
            or any(ord(c) < 32 for c in decoded)):
        raise ValueError('backend URL contains an unsafe path')
    host = parsed.hostname.lower()
    if ':' in host:
        host = f'[{host}]'
    default = 80 if parsed.scheme == 'http' else 443
    authority = host if port is None or port == default else f'{host}:{port}'
    return f'{parsed.scheme}://{authority}{parsed.path.rstrip("/")}'


def allowed_backend_url(value: str, settings: Settings) -> str:
    normalized = normalize_backend_url(value)
    target = urlsplit(normalized)
    origin = f'{target.scheme}://{target.netloc}'
    allowed = set()
    for item in settings.backend_allowed_origins.split(','):
        if not item.strip():
            continue
        entry = normalize_backend_url(item.strip())
        parsed = urlsplit(entry)
        if parsed.path:
            raise ValueError('allowed backend origins must not include a path')
        allowed.add(entry)
    if origin not in allowed:
        raise ValueError('backend origin is not allowed by deployment configuration')
    return normalized


def resolve_comfyui_url(override: str | None, settings: Settings) -> str:
    value = settings.comfyui_base_url if override is None else override
    return allowed_backend_url(value, settings)
