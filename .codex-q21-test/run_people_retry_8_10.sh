#!/usr/bin/env bash
# 8-10 参考图人数修正重测：16:9 一字排开 + 逐人枚举 + 25 steps 生产档
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_image/q21_people_20261001"

MP="1.0"; STEPS="25"; CFG="1.0"; SEED=20261001
ASPECT="16:9 (Widescreen)"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发的女人"
  [2]="蓝色牛仔外套、棕色波浪卷发的女人"
  [3]="白色衬衫配黑色长裙、金色短发的女人"
  [4]="绿色毛衣、黑色齐肩发的女人"
  [5]="黄色连帽卫衣、粉色头发的女人"
  [6]="紫色旗袍、黑色盘发的女人"
  [7]="橙色飞行员夹克、灰色短发的女人"
  [8]="黑色西装套裙、深棕色马尾的女人"
  [9]="天蓝色连衣裙、银白色长发的女人"
  [10]="灰色长风衣、亚麻色长发的女人"
)
declare -A CN=([8]=八 [9]=九 [10]=十)
declare -A EP=([8]=octa_blend [9]=nona_blend [10]=deca_blend)
declare -A NAME=([8]=08 [9]=09 [10]=10)

build_desc() {
  local n=$1 desc="" i
  for i in $(seq 1 "$n"); do
    desc+="${i})${LOOK[$i]}；"
  done
  echo "$desc"
}

echo "case|refs|http|seconds|bytes"
for N in 8 9 10; do
  n="${CN[$N]}"
  desc=$(build_desc "$N")
  prompt="${n}个女人在漫展大厅里水平排成一排开心合影，全身照，人与人之间留有空隙、互不遮挡，每个人都完整可见、正对镜头。从左到右依次是：${desc}画面中必须恰好${n}个女人，一个不多、一个不少，每个人严格对应一张参考图并保持其发型、发色与服装颜色。"
  args=(-s -o "$OUT/${NAME[$N]}_people_${N}ref_v2.png" -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/${EP[$N]}")
  args+=(-F "prompt=$prompt" -F "aspect_ratio=$ASPECT" -F "megapixels=$MP" -F "steps=$STEPS" -F "cfg=$CFG" -F "seed=$SEED")
  for i in $(seq 1 "$N"); do
    args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png")
  done
  result=$(curl "${args[@]}")
  size=$(stat -c%s "$OUT/${NAME[$N]}_people_${N}ref_v2.png" 2>/dev/null || echo 0)
  echo "people_${N}ref_v2|/api/${EP[$N]}|$N|$result|$size"
done
echo DONE
