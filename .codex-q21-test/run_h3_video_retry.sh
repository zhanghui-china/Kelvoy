#!/usr/bin/env bash
# H3 参考图生视频重试：带队列自动清理 + 单图参数修正
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_video/h3_ref2video_20261001"

DUR=5; SEED=20261001; STEPS=8; TIMEOUT=600

declare -A CN=([1]=一 [2]=两 [3]=三 [4]=四 [5]=五 [6]=六 [7]=七 [8]=八 [9]=九)
declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发" [5]="黄色连帽卫衣、粉色头发" [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾" [9]="天蓝色连衣裙、银白色长发"
)
declare -A EP=([1]=single_ref [2]=dual_ref [3]=tri_ref [4]=quad_ref [5]=penta_ref [6]=hexa_ref [7]=hepta_ref [8]=octa_ref [9]=nona_ref)

desc() { local n=$1 d="" i; for i in $(seq 1 "$n"); do d+="${i})${LOOK[$i]}；"; done; echo "$d"; }

cleanup_queue() {
  curl -s -X POST http://127.0.0.1:8188/interrupt 2>/dev/null
  curl -s -X POST http://127.0.0.1:8188/queue -H "Content-Type: application/json" -d '{"clear": true}' 2>/dev/null
  sleep 5
}

run_case() {
  local MP=$1 N=$2
  local tag="mp${MP}_ref${N}" ep="${EP[$N]}" n="${CN[$N]}"
  local existing_size
  existing_size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  if [ "$existing_size" -gt 10000 ]; then echo "$tag|SKIP(already $existing_size bytes)"; return; fi

  local prompt
  if [ "$N" -eq 1 ]; then
    prompt="画面中${n}个穿${LOOK[1]}的女人在户外花园中散步，全身可见，动作自然流畅"
  else
    prompt="${n}个女人在户外花园中一起散步，水平排成一排前行，全身可见，互不遮挡。从左到右依次是：$(desc "$N")画面中必须恰好${n}个女人，一个不多一个不少。"
  fi

  local args=(-s --max-time $TIMEOUT -o "$OUT/${tag}.mp4" -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/${ep}")
  args+=(-F "prompt=$prompt" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED")
  if [ "$N" -eq 1 ]; then
    args+=(-F "image=@$IN/person_01.png")
  else
    for i in $(seq 1 "$N"); do args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png"); done
  fi

  local result
  result=$(curl "${args[@]}")
  local size
  size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  if [ "$size" -lt 10000 ]; then
    echo "$tag|$result|FAIL"
    cleanup_queue
  else
    echo "$tag|$result|$size"
  fi
  sleep 5
}

echo "case|http|seconds|bytes"
# 0.4 MP: 重试 ref1(修正参数) + ref4-9(队列清理后重试)
for N in 1 4 5 6 7 8 9; do run_case 0.4 "$N"; done
# 0.9 MP: 全部重试
for N in 1 2 3 4 5 6 7 8 9; do run_case 0.9 "$N"; done
echo DONE
