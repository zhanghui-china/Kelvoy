#!/usr/bin/env bash
# MiniMax-H3 图片+视频+音频组合场景测试（排除纯图片，总数≤12，2秒）
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
CI="$HOME/ComfyUI/input"
OUT="output_video/h3_combo_20261001"
mkdir -p "$OUT"

DUR=2; SEED=20261001; STEPS=4; MP=0.2; TIMEOUT=600

# 素材
V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"
V2="7月2日 (1).mp4"
V3="MiniMax_H3_sage_smoke_test_cached_00001_.mp4"
A1="q21_speech.mp3"; A2="ref_S1.mp3"; A3="ref_S2.mp3"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发"   [5]="黄色连帽卫衣、粉色头发"     [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾"   [9]="天蓝色连衣裙、银白色长发"
)

img_args() { local n=$1; shift; local out=""; for i in $(seq 1 "$n"); do out+="-F image$i=@$IN/person_$(printf '%02d' "$i").png "; done; echo "$out"; }
vid_args() { local n=$1; local vs=("$V1" "$V2" "$V3"); local out=""; for i in $(seq 1 "$n"); do out+="-F video$i=@$CI/${vs[$((i-1))]} "; done; echo "$out"; }
aud_args() { local n=$1; local as=("$A1" "$A2" "$A3"); local out=""; for i in $(seq 1 "$n"); do out+="-F audio$i=@$CI/${as[$((i-1))]} "; done; echo "$out"; }

desc() { local n=$1 d="" i; for i in $(seq 1 "$n"); do d+="${LOOK[$i]}；"; done; echo "$d"; }

run_case() {
  local id=$1 ni=$2 nv=$3 na=$4
  local total=$((ni + nv + na))
  local tag="combo_${id}_${ni}i${nv}v${na}a"

  local prompt
  if [ "$ni" -eq 1 ]; then
    prompt="参考图中的${LOOK[1]}女人在参考视频的场景中活动"
  else
    prompt="${ni}位参考图中的女人在参考视频的场景中一起活动，每个人保持参考图中的外貌特征"
  fi
  if [ "$na" -gt 0 ]; then
    prompt="${prompt}，画面配合参考音频的节奏"
  fi

  local args="-s --max-time $TIMEOUT -o $OUT/${tag}.mp4 -w %{http_code}_%{time_total} -X POST $BRIDGE/api/video/multi_modal -F prompt=$prompt -F duration=$DUR -F megapixels=$MP -F steps=$STEPS -F seed=$SEED"
  eval "curl $args $(img_args $ni) $(vid_args $nv) $(aud_args $na)" > /tmp/curl_out 2>&1
  local result=$(cat /tmp/curl_out | tail -1)
  local size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  echo "$tag|$ni+$nv+$na=$total|$result|$size"
  sleep 5
}

echo "case|img+vid+aud=total|http_seconds|bytes"
# ── 最小组合（2–3 文件）──
run_case 01 1 1 0   # 1图+1视频
run_case 02 1 0 1   # 1图+1音频
run_case 03 1 1 1   # 1图+1视频+1音频
run_case 04 2 1 0   # 2图+1视频
run_case 05 2 0 1   # 2图+1音频

# ── 中等组合（4–8 文件）──
run_case 06 3 1 1   # 3图+1视频+1音频
run_case 07 3 2 0   # 3图+2视频
run_case 08 3 0 3   # 3图+3音频（音频满配）
run_case 09 5 1 1   # 5图+1视频+1音频
run_case 10 5 2 0   # 5图+2视频
run_case 11 5 0 3   # 5图+3音频
run_case 12 6 2 0   # 6图+2视频
run_case 13 7 1 0   # 7图+1视频

# ── 高压组合（9–12 文件）──
run_case 14 7 3 0   # 7图+3视频（视频满配）
run_case 15 8 2 2   # 8图+2视频+2音频
run_case 16 9 3 0   # 9图+3视频（图+视频均满配）
run_case 17 9 0 3   # 9图+3音频（图+音频均满配）
run_case 18 9 1 2   # 9图+1视频+2音频
run_case 19 6 3 3   # 6图+3视频+3音频（三模态均衡满配）
run_case 20 8 3 1   # 8图+3视频+1音频

echo DONE
