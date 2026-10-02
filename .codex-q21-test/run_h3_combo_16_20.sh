#!/usr/bin/env bash
# 超时 1200s 重跑 #16 和 #20（3 视频 + 8-9 图极限组合）
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
CI="$HOME/ComfyUI/input"
OUT="output_video/h3_combo_20261001"

DUR=2; SEED=20261001; STEPS=4; MP=0.2; TIMEOUT=1200

V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"
V2="ref_video_02.mp4"
V3="MiniMax_H3_sage_smoke_test_cached_00001_.mp4"
A1="q21_speech.mp3"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发"   [5]="黄色连帽卫衣、粉色头发"     [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾"   [9]="天蓝色连衣裙、银白色长发"
)

run() {
  local id=$1 ni=$2 nv=$3 na=$4
  local tag="combo_${id}_${ni}img_${nv}vid_${na}aud"
  local prompt="${ni}位参考图中的女人在参考视频的场景中一起活动，每个人保持参考图中的外貌特征"
  [ "$na" -gt 0 ] && prompt="${prompt}，画面配合参考音频的节奏"

  local -a args=(curl -s --max-time $TIMEOUT -o "$OUT/${tag}.mp4"
    -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/multi_modal"
    -F "prompt=$prompt" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED")

  for i in $(seq 1 "$ni"); do args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png"); done
  local -a vs=("$V1" "$V2" "$V3")
  for i in $(seq 1 "$nv"); do args+=(-F "video$i=@$CI/${vs[$((i-1))]}"); done
  local -a as=("$A1")
  for i in $(seq 1 "$na"); do args+=(-F "audio$i=@$CI/${as[$((i-1))]}"); done

  local result
  result=$("${args[@]}")
  local size
  size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  echo "$tag|$ni+$nv+$na=$((ni+nv+na))|$result|$size"
}

echo "case|combo|http|seconds|bytes"
run 16 9 3 0
run 20 8 3 1
echo DONE
