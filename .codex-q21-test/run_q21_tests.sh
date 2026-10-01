#!/usr/bin/env bash
# Qwen-Image 2.1 参考图生图全案例回归测试（标准步骤，对齐 2026-09-29 记录）
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_image/q21_retest_20261001"
mkdir -p "$OUT"

ASPECT="1:1 (Square)"
MP="1.0"
STEPS="10"
CFG="1.0"
SEED="20261001"

P_T2I="一位年轻女性旅行者站在灵山大佛前的广场上微笑，阳光明媚，旅行vlog风格"
P_EDIT="保持人物特征不变，背景改为灵山大佛景区，旅行vlog风格"
P_BLEND="参考图中的年轻女性旅行者游览参考图中的地标景点，画面自然融合，旅行vlog风格"

run_case() {
  local name="$1" endpoint="$2" files="$3" prompt="$4"
  local args=(-s -o "$OUT/${name}.png" -w "%{http_code} %{time_total}" -X POST "$BRIDGE$endpoint")
  args+=(-F "prompt=$prompt" -F "aspect_ratio=$ASPECT" -F "megapixels=$MP" -F "steps=$STEPS" -F "cfg=$CFG" -F "seed=$SEED")
  local i=1
  for f in $files; do
    args+=(-F "image$i=@$IN/$f")
    i=$((i+1))
  done
  local result
  result=$(curl "${args[@]}")
  local size
  size=$(stat -c%s "$OUT/${name}.png" 2>/dev/null || echo 0)
  echo "$name|$endpoint|$(echo $files | wc -w)|$result|$size"
}

echo "case|endpoint|refs|http|seconds|bytes"
run_case "01_text2img"    "/api/text2img"    ""                                                         "$P_T2I"
run_case "02_edit_1ref"   "/api/edit"        "c_official_aching_front.jpg"                               "$P_EDIT"
run_case "03_blend_2ref"  "/api/blend"       "c_official_aching_front.jpg lingshan_01.jpg"               "$P_BLEND"
run_case "04_triple_3ref" "/api/triple_blend" "c_official_aching_front.jpg c_official_aching_side.jpg lingshan_01.jpg" "$P_BLEND"
run_case "05_quad_4ref"   "/api/quad_blend"  "c_official_aching_front.jpg c_official_aching_side.jpg c_official_aching_full.jpg lingshan_01.jpg" "$P_BLEND"
run_case "06_penta_5ref"  "/api/penta_blend" "c_official_aching_front.jpg c_official_aching_side.jpg c_official_aching_full.jpg lingshan_01.jpg lingshan_02.jpg" "$P_BLEND"
run_case "07_hexa_6ref"   "/api/hexa_blend"  "c_official_aching_front.jpg c_official_aching_side.jpg c_official_aching_full.jpg lingshan_01.jpg lingshan_02.jpg lingshan_03.jpg" "$P_BLEND"
run_case "08_hepta_7ref"  "/api/hepta_blend" "c_official_aching_front.jpg c_official_aching_side.jpg c_official_aching_full.jpg lingshan_01.jpg lingshan_02.jpg lingshan_03.jpg huangshan_01.jpg" "$P_BLEND"
run_case "09_octa_8ref"   "/api/octa_blend"  "c_official_aching_front.jpg c_official_aching_side.jpg c_official_aching_full.jpg lingshan_01.jpg lingshan_02.jpg lingshan_03.jpg huangshan_01.jpg huangshan_02.jpg" "$P_BLEND"
run_case "10_nona_9ref"   "/api/nona_blend"  "c_official_aching_front.jpg c_official_aching_side.jpg c_official_aching_full.jpg lingshan_01.jpg lingshan_02.jpg lingshan_03.jpg huangshan_01.jpg huangshan_02.jpg huangshan_03.jpg" "$P_BLEND"
echo "DONE"
