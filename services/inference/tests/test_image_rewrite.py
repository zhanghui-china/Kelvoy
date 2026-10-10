import hashlib
import json

from fastapi.testclient import TestClient
from PIL import Image

from inference.app import app


def test_rewrite_reads_ordered_images_and_returns_only_validated_answer(tmp_path, monkeypatch):
    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'true')
    refs = ['person.png', 'scene.png']
    for key, color in zip(refs, ['red', 'blue'], strict=True):
        Image.new('RGB', (10, 20), color).save(tmp_path / key)
    hashes = [hashlib.sha256((tmp_path / key).read_bytes()).hexdigest() for key in refs]
    seen = []

    async def fake_complete(messages):
        seen.append(messages)
        return 'private thought</think>' + json.dumps({
            'rewritten_prompt': ("Close-up of <image1>'s hands holding a pastry "
                                 "in <image2>'s scene."),
            'wh_ratio': '9:16', 'ratio_follow': '',
        })

    monkeypatch.setattr('inference.image_rewrite.complete', fake_complete)
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '9:16', 'kf_prompt': '只拍手和烧饼',
                    'size': 'detail', 'camera': 'static'},
        'refs': refs, 'expected_ref_hashes': hashes,
    })
    assert response.status_code == 200
    body = response.json()
    assert body['reference_hashes'] == hashes
    assert 'private thought' not in response.text
    parts = seen[0][1]['content']
    assert len(parts) == 3
    assert parts[0]['image_url']['url'] != parts[1]['image_url']['url']
    assert '只拍手和烧饼' in parts[2]['text']
    assert 'untrusted source data' in parts[2]['text']
    assert 'ONLY the hands and the pastry' in parts[2]['text']
    assert 'static composition' in parts[2]['text']


def test_metadata_is_pinned_and_available_while_disabled():
    response = TestClient(app).get('/image/rewrite/metadata/')
    assert response.status_code == 200
    assert len(response.json()['model_revision']) == 40
    assert response.json()['sampling']['enable_thinking'] is True


def test_rewrite_rejects_changed_reference_before_model(tmp_path, monkeypatch):
    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'true')
    Image.new('RGB', (10, 10)).save(tmp_path / 'person.png')
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '16:9', 'kf_prompt': 'hello'},
        'refs': ['person.png'], 'expected_ref_hashes': ['0' * 64],
    })
    assert response.status_code == 422


def test_rewrite_corrects_ratio_once_then_fails(tmp_path, monkeypatch):
    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'true')
    Image.new('RGB', (10, 10)).save(tmp_path / 'person.png')
    digest = hashlib.sha256((tmp_path / 'person.png').read_bytes()).hexdigest()
    calls = []

    async def fake_complete(messages):
        calls.append(messages)
        return '{"rewritten_prompt":"A close-up pastry", "wh_ratio":"16:9", "ratio_follow":""}'

    monkeypatch.setattr('inference.image_rewrite.complete', fake_complete)
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '9:16', 'kf_prompt': '烧饼'},
        'refs': ['person.png'], 'expected_ref_hashes': [digest],
    })
    assert response.status_code == 502
    assert len(calls) == 2
    assert '9:16' in calls[-1][1]['content'][-1]['text']


def test_image_generation_checks_hash_before_upload(tmp_path, monkeypatch):
    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    Image.new('RGB', (10, 10)).save(tmp_path / 'person.png')
    response = TestClient(app).post('/image/', json={
        'prompt': 'A pastry', 'refs': ['person.png'], 'expected_ref_hashes': ['0' * 64],
    })
    assert response.status_code == 422


def test_rewrite_timeout_cancels_pending_backend(tmp_path, monkeypatch):
    import asyncio

    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'true')
    monkeypatch.setattr('inference.image_rewrite.TIMEOUT_S', 0.01)
    Image.new('RGB', (10, 10)).save(tmp_path / 'person.png')
    digest = hashlib.sha256((tmp_path / 'person.png').read_bytes()).hexdigest()
    cancelled = []

    async def blocked(messages):
        try:
            await asyncio.sleep(60)
        finally:
            cancelled.append(True)

    monkeypatch.setattr('inference.image_rewrite.complete', blocked)
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '9:16', 'kf_prompt': '烧饼'},
        'refs': ['person.png'], 'expected_ref_hashes': [digest],
    })
    assert response.status_code == 504
    assert cancelled == [True]


def test_answer_validation_rejects_illegal_markers_non_english_and_ratio_follow():
    import pytest

    from inference.image_rewrite import validate_answer

    for prompt, follow in [('A <image3> pastry', ''), ('烧饼', ''), ('A pastry', '<image1>')]:
        with pytest.raises(ValueError):
            validate_answer(json.dumps({'rewritten_prompt': prompt, 'wh_ratio': '9:16',
                                        'ratio_follow': follow}), '9:16', 2)


def test_rewrite_disabled_does_not_contact_model(monkeypatch):
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'false')
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '9:16', 'kf_prompt': '烧饼'},
        'refs': ['person.png'], 'expected_ref_hashes': ['0' * 64],
    })
    assert response.status_code == 503


def test_completion_uses_official_sampling_and_discards_reasoning(monkeypatch):
    import asyncio

    import httpx

    from inference.image_rewrite import complete

    seen = []

    def backend(request):
        seen.append(json.loads(request.content))
        events = [
            {'choices': [{'delta': {'reasoning_content': 'private thought'}}]},
            {'choices': [{'delta': {'content': '{"rewritten_prompt":"A pastry"}'}}]},
        ]
        return httpx.Response(200, text='\n'.join(
            ['data: ' + json.dumps(event) for event in events] + ['data: [DONE]']
        ))

    real_client = httpx.AsyncClient
    monkeypatch.setattr('inference.image_rewrite.httpx.AsyncClient',
                        lambda **kwargs: real_client(transport=httpx.MockTransport(backend)))
    output = asyncio.run(complete([{'role': 'user', 'content': 'pastry'}]))
    assert 'private thought' not in output
    assert seen[0]['max_tokens'] == 24000
    assert seen[0]['presence_penalty'] == 0
    assert seen[0]['top_k'] == 20
    assert seen[0]['chat_template_kwargs'] == {'enable_thinking': True}


def test_valid_correction_preserves_requested_aspect(tmp_path, monkeypatch):
    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'true')
    Image.new('RGB', (10, 10)).save(tmp_path / 'person.png')
    digest = hashlib.sha256((tmp_path / 'person.png').read_bytes()).hexdigest()
    answers = iter(['garbled output', json.dumps({
        'rewritten_prompt': 'Close-up of the hands of <image1> holding a pastry.',
        'wh_ratio': '16:9', 'ratio_follow': '',
    })])

    async def fake_complete(messages):
        return next(answers)

    monkeypatch.setattr('inference.image_rewrite.complete', fake_complete)
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '16:9', 'kf_prompt': '只拍手和烧饼'},
        'refs': ['person.png'], 'expected_ref_hashes': [digest],
    })
    assert response.status_code == 200
    assert response.json()['wh_ratio'] == '16:9'



def test_answer_rejects_prose_canvas_conflict():
    import pytest

    from inference.image_rewrite import validate_answer

    with pytest.raises(ValueError, match="canvas"):
        validate_answer(json.dumps({
            'rewritten_prompt': 'Only hands and a pastry, horizontal 16:9 frame.',
            'wh_ratio': '9:16', 'ratio_follow': '',
        }), '9:16', 1)


def test_rewrite_deadline_includes_image_preprocessing(tmp_path, monkeypatch):
    import time

    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'true')
    monkeypatch.setattr('inference.image_rewrite.TIMEOUT_S', 0.01)
    Image.new('RGB', (10, 10)).save(tmp_path / 'person.png')
    digest = hashlib.sha256((tmp_path / 'person.png').read_bytes()).hexdigest()
    calls = []

    def slow_image(blob):
        time.sleep(0.04)
        return 'data:image/png;base64,unused'

    async def fake_complete(messages):
        calls.append(messages)
        return '{"rewritten_prompt":"A pastry", "wh_ratio":"9:16", "ratio_follow":""}'

    monkeypatch.setattr('inference.image_rewrite.image_uri', slow_image)
    monkeypatch.setattr('inference.image_rewrite.complete', fake_complete)
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '9:16', 'kf_prompt': '烧饼'},
        'refs': ['person.png'], 'expected_ref_hashes': [digest],
    })
    assert response.status_code == 504
    assert calls == []


def test_completion_cancellation_closes_actual_http_stream(monkeypatch):
    import asyncio

    import httpx

    from inference.image_rewrite import complete

    closed = []
    started = asyncio.Event()

    class BlockingStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            started.set()
            await asyncio.sleep(60)

        async def aclose(self):
            closed.append(True)

    async def backend(request):
        return httpx.Response(200, stream=BlockingStream())

    real_client = httpx.AsyncClient
    monkeypatch.setattr('inference.image_rewrite.httpx.AsyncClient',
                        lambda **kwargs: real_client(transport=httpx.MockTransport(backend)))

    async def cancel():
        task = asyncio.create_task(complete([{'role': 'user', 'content': 'pastry'}]))
        await started.wait()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError('completion swallowed cancellation')

    asyncio.run(cancel())
    assert closed == [True]


def test_requested_face_and_eating_detail_is_not_overridden(tmp_path, monkeypatch):
    monkeypatch.setenv('KELVOY_PROJECTS_ROOT', str(tmp_path))
    monkeypatch.setenv('KELVOY_IMAGE_REWRITE_ENABLED', 'true')
    Image.new('RGB', (10, 10)).save(tmp_path / 'person.png')
    digest = hashlib.sha256((tmp_path / 'person.png').read_bytes()).hexdigest()
    seen = []

    async def fake_complete(messages):
        seen.append(messages)
        return json.dumps({
            'rewritten_prompt': 'A close-up of the face of <image1> biting a shaobing pastry.',
            'wh_ratio': '9:16', 'ratio_follow': '',
        })

    monkeypatch.setattr('inference.image_rewrite.complete', fake_complete)
    response = TestClient(app).post('/image/rewrite/', json={
        'context': {'mode': 'edit', 'aspect': '9:16', 'size': 'detail',
                    'kf_prompt': '人物咬一口烧饼的面部特写'},
        'refs': ['person.png'], 'expected_ref_hashes': [digest],
    })
    assert response.status_code == 200
    instruction = seen[0][1]['content'][-1]['text']
    assert 'ONLY the hands and the pastry' not in instruction
    assert 'unless requested' in instruction
