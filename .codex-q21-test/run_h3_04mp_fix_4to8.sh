#!/usr/bin/env bash
# WebSocket 修复后补测 0.4MP 4-8 图
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_video/h3_ref2video_20261001"

DUR=5; SEED=20261001; STEPS=8; MP=0.4; TIMEOUT=600

declare -A CN=([4]=四 [5]=五 [6]=六 [7]=七 [8]=八)
declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发" [5]="黄色连帽卫衣、粉色头发" [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾" [9]="天蓝色连衣裙、银白色长发"
)
declare -A EP=([4]=quad_ref [5]=penta_ref [6]=hexa_ref [7]=hepta_ref [8]=octa_ref)

desc() { local n=$1 d="" i; for i in $(seq 1 "$n"); do d+="${i})${LOOK[$i]}；"; done; echo "$d"; }

echo "case|endpoint|refs|http|seconds|bytes"
for N in 4 5 6 7 8; do
  n="${CN[$N]}" ep="${EP[$N]}" tag="mp${MP}_ref${N}_v2"
  prompt="${n}个女人在户外花园中一起散步，水平排成一排前行，全身可见，互不遮挡。从左到右依次是：$(desc "$N")画面中必须恰好${n}个女人，一个不多一个不少。"
  args=(-s --max-time $TIMEOUT -o "$OUT/${tag}.mp4" -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/${ep}")
  args+=(-F "prompt=$prompt" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED")
  for i in $(seq 1 "$N"); do
    args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png")
  done
  result=$(curl "${args[@]}")
  size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  echo "$tag|${ep}|$N|$result|$size"
  sleep 5
done
echo DONE
