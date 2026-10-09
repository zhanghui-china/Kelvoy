"""Bounded diagnostics: only GET endpoints, never a generation or queue mutation."""
import asyncio
import json
import time
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from inference.backends import allowed_backend_url
from inference.comfyui import BRIDGE, TEMPLATES
from inference.config import Settings

router = APIRouter()
REQUEST_TIMEOUT_S = 5
TOTAL_TIMEOUT_S = 15
_inflight: dict[tuple, asyncio.Task] = {}
MODEL_INPUTS = {'unet_name', 'vae_name', 'clip_name', 'lora_name', 'model_name', 'ckpt_name'}


class DiagnosticRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    comfyui_base_url: str | None = None
    bridge_base_url: str | None = None


async def get_object(client: httpx.AsyncClient, address: str, path: str) -> dict:
    async with asyncio.timeout(REQUEST_TIMEOUT_S):
        response = await client.get(address + path)
        response.raise_for_status()
        value = response.json()
        if not isinstance(value, dict):
            raise ValueError('expected a JSON object')
        return value


def dependencies(info: dict) -> list[dict]:
    checks = []
    for workflow, (filename, *_) in TEMPLATES.items():
        template = json.loads((BRIDGE / filename).read_text())
        nodes, models = set(), set()
        unchecked = False
        for node in template.values():
            kind = node['class_type']
            spec = info.get(kind)
            if not isinstance(spec, dict):
                nodes.add(kind)
                continue
            inputs = spec.get('input', {})
            if not isinstance(inputs, dict):
                inputs = {}
            fields = {}
            for group in ('required', 'optional'):
                entries = inputs.get(group, {})
                if isinstance(entries, dict):
                    fields.update(entries)
            for key, value in node['inputs'].items():
                if key not in MODEL_INPUTS or not isinstance(value, str):
                    continue
                definition = fields.get(key)
                if (not isinstance(definition, list) or not definition
                        or not isinstance(definition[0], list)):
                    unchecked = True
                    continue
                if value not in definition[0]:
                    models.add(value)
        status = 'error' if nodes or models else 'unchecked' if unchecked else 'healthy'
        checks.append({'workflow': workflow, 'missing_nodes': sorted(nodes),
                       'missing_models': sorted(models), 'status': status})
    return checks


async def inspect(client: httpx.AsyncClient, service: str, address: str) -> dict:
    started = time.monotonic()
    check = {'service': service, 'address': address, 'status': 'error'}
    if service == 'comfyui':
        check['interface_ready'] = False
    try:
        if service == 'bridge':
            payload = await get_object(client, address, '/health')
            if payload.get('status') != 'ok' or payload.get('comfyui') != 'connected':
                raise ValueError('bridge health does not confirm its backend is connected')
            check['status'] = 'healthy'
        else:
            stats = await get_object(client, address, '/system_stats')
            if (not isinstance(stats.get('system'), dict)
                    or not isinstance(stats.get('devices'), list)):
                raise ValueError('invalid ComfyUI system_stats content')
            queue = await get_object(client, address, '/queue')
            running, pending = queue.get('queue_running'), queue.get('queue_pending')
            if not isinstance(running, list) or not isinstance(pending, list):
                raise ValueError('invalid ComfyUI queue content')
            check['interface_ready'] = True
            check['queue'] = {'running': len(running), 'pending': len(pending)}
            info = await get_object(client, address, '/object_info')
            check['dependencies'] = dependencies(info)
            if any(d['status'] != 'healthy' for d in check['dependencies']):
                check['reason'] = 'workflow nodes or model enumerations are missing or unchecked'
            else:
                check['status'] = 'busy' if running or pending else 'healthy'
    except (httpx.HTTPError, ValueError, OSError, KeyError, TypeError, TimeoutError) as exc:
        check['reason'] = str(exc) or type(exc).__name__
    check['duration_ms'] = round((time.monotonic() - started) * 1000)
    return check


async def run_checks(targets: tuple[tuple[str, str | None, str | None], ...]) -> dict:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S, follow_redirects=False) as client:
        tasks = {service: asyncio.create_task(inspect(client, service, address))
                 for service, address, _ in targets if address is not None}
        if tasks:
            done, pending = await asyncio.wait(tasks.values(), timeout=TOTAL_TIMEOUT_S)
        else:
            done, pending = set(), set()
        checks = []
        for service, address, reason in targets:
            task = tasks.get(service)
            if task is None:
                check = {'service': service, 'status': 'unchecked',
                         'reason': reason, 'duration_ms': 0}
                if service == 'comfyui':
                    check['interface_ready'] = False
                checks.append(check)
            elif task in done:
                checks.append(task.result())
            else:
                task.cancel()
                checks.append({'service': service, 'address': address, 'status': 'unchecked',
                               'reason': 'overall diagnostic deadline exceeded',
                               'duration_ms': round(TOTAL_TIMEOUT_S * 1000)})
        await asyncio.gather(*pending, return_exceptions=True)
        return {'checked_at': datetime.now(UTC).isoformat(), 'checks': checks}


@router.post('/diagnostics')
async def diagnostics(body: DiagnosticRequest) -> dict:
    settings = Settings()
    candidates = [('comfyui', body.comfyui_base_url, settings.comfyui_base_url),
                  ('bridge', body.bridge_base_url, settings.bridge_base_url)]
    targets = []
    # Resolve all candidates before creating tasks. An invalid explicit candidate
    # rejects the request; inherited deployment failures only skip that service.
    for service, candidate, inherited in candidates:
        try:
            address = allowed_backend_url(inherited if candidate is None else candidate, settings)
            targets.append((service, address, None))
        except ValueError as exc:
            if candidate is not None:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            targets.append((service, None, str(exc)))
    resolved = tuple(targets)
    key = (asyncio.get_running_loop(), resolved)
    task = _inflight.get(key)
    if task is None:
        task = asyncio.create_task(run_checks(resolved))
        _inflight[key] = task
        task.add_done_callback(lambda finished: _inflight.pop(key, None))
    return await asyncio.shield(task)
