"""Run against `bun run --cwd apps/web dev:web --host 127.0.0.1 --port 5178`.

Local API fixture only: checks review interaction state and write ordering, not media playback.
"""

import copy
import json
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:5178"
SHOT = {
    "no": 1, "scene": "s1", "size": "wide", "beat": "抵达", "camera": "static",
    "landmark": None, "kf_prompt": "原提示词", "motion_prompt": "行走",
    "duration_s": 1, "candidates": [], "kf_selected": None, "clip": None,
    "trim_start_s": None, "status": "draft", "regen_stage": None,
    "bad_shot_reported": False, "model": {},
}
EPISODE = {
    "episode_id": "e_pr10", "owner_id": "u_pr10", "persona_id": "p_pr10",
    "persona_version": 1, "destination_id": "d_pr10", "destination_version": 1,
    "series_id": "s_pr10", "template_id": "t_pr10", "status": "kf_review",
    "name": "PR10 审核交互", "mode": "per_shot", "video_source": "references",
    "cut_policy": "fixed_1s", "candidate_count": 2,
    "created_at": "2026-09-28T09:00:00+08:00", "estimated_credits": 10,
    "credits_used": 0, "share": {"enabled": False, "slug": ""},
    "brief": {"season": "秋", "aspect": "9:16", "requirements": "",
              "duration_s": 2, "tone": "松弛", "outfit_override": None, "banned": []},
    "grid_refs": [], "scenes": [{"id": "s1", "name": "街景", "time": "morning", "landmarks": []}],
    "shots": [], "removed_shots": [], "music": {"file": "", "bpm": 0, "license": ""},
    "render": {"res": "1080x1920", "fps": 30, "title": "", "intro": None,
               "outro": None, "ai_label": True},
}


def fixture(stage, *, fail_trim=False):
    episode = copy.deepcopy(EPISODE)
    episode["status"] = stage
    episode["shots"] = [{**SHOT, "no": no,
                         "status": "kf_ready" if stage == "kf_review" else "clip_ready",
                         "clip": None if stage == "kf_review" else f"clips/{no}.mp4"}
                        for no in (1, 2)]
    state = {"episode": episode, "version": 1, "writes": []}

    def handle(route):
        request = route.request
        path = urlparse(request.url).path
        if path == "/api/me":
            body = {"ok": True, "user": {"user_id": "u_pr10", "username": "pr10"},
                    "balance": {"available": 100, "reserved": 0}}
        elif path == "/api/episodes/e_pr10" and request.method == "GET":
            body = {"ok": True, "episode": state["episode"], "persona": None,
                    "destination": None, "destination_history_approximate": False,
                    "row_version": state["version"], "failed_task": None}
        elif path.startswith("/api/episodes/e_pr10/shots/") and request.method == "PATCH":
            payload = request.post_data_json
            state["writes"].append(payload)
            if fail_trim and "trim_start_s" in payload["patch"]:
                body = {"ok": False, "error": "version_conflict"}
            else:
                assert payload["row_version"] == state["version"], payload
                no = int(path.rsplit("/", 1)[1])
                state["episode"]["shots"][no - 1].update(payload["patch"])
                state["version"] += 1
                body = {"ok": True, "row_version": state["version"]}
        else:
            body = {"ok": False, "error": "not_in_fixture"}
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps(body, ensure_ascii=False))

    return state, handle


def open_view(browser, stage, *, fail_trim=False):
    state, handle = fixture(stage, fail_trim=fail_trim)
    page = browser.new_page(viewport={"width": 390, "height": 850})
    page.add_init_script("window.__shotScrolls=[]; Element.prototype.scrollIntoView=function(){ if(this.dataset.shotNo) window.__shotScrolls.push(this.dataset.shotNo); }")
    page.route(f"{BASE}/api/**", handle)
    page.goto(f"{BASE}/episodes/e_pr10", wait_until="networkidle")
    page.get_by_role("navigation", name="镜头导航").wait_for()
    return page, state


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)

    page, _ = open_view(browser, "kf_review")
    page.get_by_role("button", name="改 prompt 并重生成").click()
    page.get_by_label("关键帧 prompt").fill("尚未保存的提示词")
    page.get_by_role("button", name="下一镜").click()
    assert page.locator(".k-desk-shot:not([hidden]) .k-desk-shot-no").inner_text() == "第 2 镜"
    assert "2" in page.evaluate("window.__shotScrolls")
    page.get_by_role("button", name="上一镜").click()
    assert page.get_by_label("关键帧 prompt").input_value() == "尚未保存的提示词"
    page.close()

    page, failed_state = open_view(browser, "clip_review", fail_trim=True)
    first = page.locator('.k-desk-shot[data-shot-no="1"]')
    first.get_by_label("人物一致").check()
    first.locator('input[type="range"]').focus()
    first.locator('input[type="range"]').press("ArrowRight")
    dirty = first.locator('input[type="range"]').input_value()
    page.get_by_role("button", name="下一镜").click()
    page.get_by_role("button", name="上一镜").click()
    assert first.get_by_label("人物一致").is_checked()
    assert first.locator('input[type="range"]').input_value() == dirty
    for name in ("手部正常", "地标形态正确", "物理合理", "无可读文字"):
        first.get_by_label(name).check()
    first.locator('input[type="range"]').focus()
    first.get_by_role("button", name="通过这一镜").click()
    page.wait_for_timeout(300)
    assert all(item["patch"].get("status") != "approved" for item in failed_state["writes"])
    page.close()

    page, state = open_view(browser, "clip_review")
    first = page.locator('.k-desk-shot[data-shot-no="1"]')
    for name in ("人物一致", "手部正常", "地标形态正确", "物理合理", "无可读文字"):
        first.get_by_label(name).check()
    slider = first.locator('input[type="range"]')
    slider.focus()
    slider.press("ArrowRight")
    first.get_by_role("button", name="通过这一镜").click()
    page.wait_for_function("document.querySelector('[data-shot-no=\"1\"] .k-pill')?.textContent === '已通过'", timeout=10000)
    assert len(state["writes"]) == 2, state["writes"]
    assert "trim_start_s" in state["writes"][0]["patch"]
    assert state["writes"][1]["patch"] == {"status": "approved"}
    assert [item["row_version"] for item in state["writes"]] == [1, 2]
    page.close()

    browser.close()
print("PR10 browser interactions passed")
