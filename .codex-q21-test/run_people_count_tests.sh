#!/usr/bin/env bash
# 多参考图融合「人数一致性」测试：N 张参考图（每图一位不同人物）→ 输出应恰好 N 人
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_image/q21_people_20261001"
mkdir -p "$OUT"

ASPECT="1:1 (Square)"
MP="1.0"; STEPS="10"; CFG="1.0"; BASE_SEED=20261001

# ---------- 第一步：生成 10 位互不相同的女性人像作为参考图 ----------
declare -A LOOK=(
  [1]="红色连衣裙，黑色长直发"
  [2]="蓝色牛仔外套，棕色波浪卷发"
  [3]="白色衬衫配黑色长裙，金色短发"
  [4]="绿色毛衣，黑色齐肩发"
  [5]="黄色连帽卫衣，粉色染发"
  [6]="紫色旗袍，黑色盘发"
  [7]="橙色飞行员夹克，灰色短发"
  [8]="黑色西装套裙，深棕色马尾"
  [9]="天蓝色连衣裙，银白色长发"
  [10]="灰色长风衣，亚麻色长发"
)

for i in 1 2 3 4 5 6 7 8 9 10; do
  f="$IN/person_$(printf '%02d' "$i").png"
  if [ -s "$f" ]; then echo "skip gen $f"; continue; fi
  curl -s -o "$f" -w "gen_person_$i|%{http_code} %{time_total}\n" -X POST "$BRIDGE/api/text2img" \
    -F "prompt=一位年轻亚洲女性的单人全身照，纯白摄影棚背景，正面站姿，面部清晰，${LOOK[$i]}" \
    -F "aspect_ratio=$ASPECT" -F "megapixels=$MP" -F "steps=$STEPS" -F "cfg=$CFG" \
    -F "seed=$((BASE_SEED + i))"
done

# ---------- 第二步：2-10 参考图融合，强约束人数 ----------
declare -A CN=([2]=两 [3]=三 [4]=四 [5]=五 [6]=六 [7]=七 [8]=八 [9]=九 [10]=十)
declare -A EP=([2]=blend [3]=triple_blend [4]=quad_blend [5]=penta_blend [6]=hexa_blend [7]=hepta_blend [8]=octa_blend [9]=nona_blend [10]=deca_blend)
declare -A NAME=([2]=02 [3]=03 [4]=04 [5]=05 [6]=06 [7]=07 [8]=08 [9]=09 [10]=10)

echo "case|refs|http|seconds|bytes"
for N in 2 3 4 5 6 7 8 9 10; do
  n="${CN[$N]}"
  args=(-s -o "$OUT/${NAME[$N]}_people_${N}ref.png" -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/${EP[$N]}")
  args+=(-F "prompt=${n}个女人一起在漫展上开心合影，画面中必须恰好出现${n}个不同的女人：每个女人分别来自一张参考图，严格保持各自的发型、发色和服装颜色；一个都不能少，也一个都不能多" \
         -F "aspect_ratio=$ASPECT" -F "megapixels=$MP" -F "steps=$STEPS" -F "cfg=$CFG" -F "seed=$BASE_SEED")
  for i in $(seq 1 "$N"); do
    args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png")
  done
  result=$(curl "${args[@]}")
  size=$(stat -c%s "$OUT/${NAME[$N]}_people_${N}ref.png" 2>/dev/null || echo 0)
  echo "people_${N}ref|/api/${EP[$N]}|$N|$result|$size"
done
echo DONE
