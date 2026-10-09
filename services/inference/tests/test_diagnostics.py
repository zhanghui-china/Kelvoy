"""System checks must stay read-only and distrust healthy HTTP status alone."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from inference.app import app
from inference.comfyui import BRIDGE, TEMPLATES


def object_info():
    result = {}
    for filename, *_ in TEMPLATES.values():
        for node in json.loads((BRIDGE / filename).read_text()).values():
            spec = result.setdefault(node['class_type'], {'input': {'required': {}}})
            for key, value in node['inputs'].items():
                if key in ('unet_name', 'vae_name', 'clip_name', 'lora_name'):
                    enum = spec['input']['required'].setdefault(key, [[]])[0]
                    if value not in enum:
                        enum.append(value)
    return result


@pytest.fixture
def backend(monkeypatch):
    monkeypatch.setenv('KELVOY_BACKEND_ALLOWED_ORIGINS', 'http://comfy:8188,http://bridge:5099')
    monkeypatch.setenv('KELVOY_COMFYUI_BASE_URL', 'http://comfy:8188')
    monkeypatch.setenv('KELVOY_BRIDGE_BASE_URL', 'http://bridge:5099')
    calls = []
    payloads = {'/system_stats': {'system': {}, 'devices': []},
                '/queue': {'queue_running': [], 'queue_pending': []},
                '/object_info': object_info(), '/health': {'status': 'ok', 'comfyui': 'connected'}}

    def handler(request):
        calls.append(request)
        value = payloads[request.url.path]
        if isinstance(value, Exception):
            raise value
        if isinstance(value, httpx.Response):
            return value
        return httpx.Response(200, json=value)

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(
        **kw, transport=httpx.MockTransport(handler)))
    return payloads, calls


def check():
    return TestClient(app).post('/system/diagnostics', json={})


def test_checks_four_generation_templates_read_only(backend):
    response = check()
    assert response.status_code == 200
    checks = response.json()['checks']
    assert [item['status'] for item in checks] == ['healthy', 'healthy']
    assert len(checks[0]['dependencies']) == 4
    assert all(item['status'] == 'healthy' for item in checks[0]['dependencies'])
    assert {str(r.url.path) for r in backend[1]} == {
        '/system_stats', '/queue', '/object_info', '/health'}
    assert all(r.method == 'GET' for r in backend[1])


@pytest.mark.parametrize('path,value', [
    ('/system_stats', {}), ('/queue', {}), ('/object_info', []),
    ('/health', {'status': 'ok', 'comfyui': 'unreachable'}),
    ('/system_stats', httpx.Response(500)),
    ('/system_stats', httpx.Response(302, headers={'location': 'http://evil/'})),
    ('/system_stats', httpx.ConnectError('connection refused')),
    ('/system_stats', httpx.ReadTimeout('timed out')),
])
def test_partial_failure_is_reported_without_mutations(backend, path, value):
    backend[0][path] = value
    result = check().json()['checks']
    failed = 1 if path == '/health' else 0
    assert result[failed]['status'] == 'error'
    assert result[1-failed]['status'] == 'healthy'
    assert result[failed]['reason']
    assert all(r.method == 'GET' for r in backend[1])


def test_busy_and_missing_dependencies(backend):
    backend[0]['/queue']['queue_pending'] = [[1, 'id']]
    result = check().json()['checks'][0]
    assert result['status'] == 'busy'
    assert result['queue'] == {'running': 0, 'pending': 1}
    del backend[0]['/object_info']['UNETLoader']
    backend[0]['/object_info']['VAELoader']['input']['required']['vae_name'] = [[]]
    result = check().json()['checks'][0]
    assert result['status'] == 'error'
    assert result['interface_ready'] is True
    assert any(d['missing_nodes'] for d in result['dependencies'])
    assert any(d['missing_models'] for d in result['dependencies'])


@pytest.mark.parametrize('address', ['ftp://comfy:8188', 'http://u:p@comfy:8188',
    'http://comfy:8188?q=1', 'http://comfy:8188#x', 'http://evil:8188',
    'http://comfy:8188/?', 'http://comfy:8188/#', 'http://comfy:8188\\evil'])
def test_bad_candidates_rejected_before_contact(backend, address):
    response = TestClient(app).post('/system/diagnostics', json={'comfyui_base_url': address})
    assert response.status_code == 422
    assert backend[1] == []


def test_empty_allowlist_denies_diagnostics(backend, monkeypatch):
    monkeypatch.setenv('KELVOY_BACKEND_ALLOWED_ORIGINS', '')
    response = check()
    assert response.status_code == 200
    assert all(item['status'] == 'unchecked' for item in response.json()['checks'])
    assert backend[1] == []


@pytest.mark.parametrize('endpoint', ['/image/', '/video/'])
def test_generation_uses_allowlisted_override_and_inheritance(backend, monkeypatch, endpoint):
    seen = []
    async def generate(*args, **kwargs):
        seen.append(args[4])
        return {'paths': ['a'], 'model': 'test', 'version': '1', 'seed': 1, 'seconds': 0}
    module = 'image' if endpoint == '/image/' else 'video'
    monkeypatch.setattr(f'inference.routers.{module}.generate_comfyui', generate)
    body = {'prompt': 'a', 'refs': ['a.png'], 'comfyui_base_url': 'http://comfy:8188/'}
    assert TestClient(app).post(endpoint, json=body).status_code == 200
    assert seen == ['http://comfy:8188']
    body['comfyui_base_url'] = 'http://evil'
    assert TestClient(app).post(endpoint, json=body).status_code == 422
    monkeypatch.setenv('KELVOY_BACKEND_ALLOWED_ORIGINS', '')
    body['comfyui_base_url'] = None
    assert TestClient(app).post(endpoint, json=body).status_code == 422
    assert len(seen) == 1
    monkeypatch.setenv('KELVOY_BACKEND_ALLOWED_ORIGINS', 'http://comfy:8188')
    assert TestClient(app).post(endpoint, json=body).status_code == 200
    assert seen == ['http://comfy:8188', 'http://comfy:8188']


def test_missing_model_enumeration_is_unchecked_not_healthy(backend):
    del backend[0]['/object_info']['VAELoader']['input']['required']['vae_name']
    result = check().json()['checks'][0]
    assert result['status'] == 'error'
    assert result['interface_ready'] is True
    assert any(item['status'] == 'unchecked' for item in result['dependencies'])


def test_duplicate_concurrent_diagnostics_coalesce(backend):
    from inference.routers.system import DiagnosticRequest, diagnostics

    async def exercise():
        first, second = await asyncio.gather(diagnostics(DiagnosticRequest()),
                                             diagnostics(DiagnosticRequest()))
        assert first == second
    asyncio.run(exercise())
    assert len(backend[1]) == 4


def test_overall_deadline_marks_unfinished_checks(backend, monkeypatch):
    from inference.routers import system
    monkeypatch.setattr(system, 'TOTAL_TIMEOUT_S', 0.01)

    async def slow(*args):
        await asyncio.sleep(1)
    monkeypatch.setattr(system, 'get_object', slow)
    result = check().json()['checks']
    assert all(item['status'] == 'unchecked' for item in result)
    assert backend[1] == []


def test_request_deadline_is_enforced_even_for_transport_that_ignores_httpx(backend, monkeypatch):
    from inference.routers import system
    monkeypatch.setattr(system, 'REQUEST_TIMEOUT_S', 0.01)
    async def slow(request):
        await asyncio.sleep(1)
        return httpx.Response(200, json={})
    # The fixture wraps AsyncClient; replacing it directly allows a slow transport.
    client_type = __import__('httpx')._client.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: client_type(
        **kw, transport=httpx.MockTransport(slow)))
    result = check().json()['checks']
    assert all(item['status'] == 'error' for item in result)
    assert all(item['duration_ms'] < 500 for item in result)


@pytest.mark.parametrize('address', ['ftp://comfy:8188', 'http://u:p@comfy:8188',
                                    'http://evil:8188', 'http://comfy:8188?x=1'])
@pytest.mark.parametrize('endpoint', ['/image/', '/video/'])
def test_invalid_inherited_generation_target_denied(backend, monkeypatch, address, endpoint):
    monkeypatch.setenv('KELVOY_COMFYUI_BASE_URL', address)
    async def unexpected(*args, **kwargs):
        pytest.fail('invalid inherited target reached generation')
    module = 'image' if endpoint == '/image/' else 'video'
    monkeypatch.setattr(f'inference.routers.{module}.generate_comfyui', unexpected)
    response = TestClient(app).post(endpoint, json={'prompt': 'a', 'refs': ['a.png']})
    assert response.status_code == 422
    assert backend[1] == []


@pytest.mark.parametrize('allowed,healthy,unchecked', [
    ('http://comfy:8188', 'comfyui', 'bridge'),
    ('http://bridge:5099', 'bridge', 'comfyui'),
])
def test_inherited_target_policy_failure_is_independent(
        backend, monkeypatch, allowed, healthy, unchecked):
    monkeypatch.setenv('KELVOY_BACKEND_ALLOWED_ORIGINS', allowed)
    response = check()
    assert response.status_code == 200
    checks = {item['service']: item for item in response.json()['checks']}
    assert checks[healthy]['status'] == 'healthy'
    assert checks[unchecked]['status'] == 'unchecked'
    assert checks[unchecked]['reason']
    assert checks[unchecked]['duration_ms'] == 0
    assert {str(request.url.host) for request in backend[1]} == {
        'comfy' if healthy == 'comfyui' else 'bridge'}


def test_explicit_invalid_bridge_rejected_before_valid_comfy_probe(backend):
    response = TestClient(app).post('/system/diagnostics', json={
        'comfyui_base_url': 'http://comfy:8188', 'bridge_base_url': 'http://evil'})
    assert response.status_code == 422
    assert backend[1] == []
