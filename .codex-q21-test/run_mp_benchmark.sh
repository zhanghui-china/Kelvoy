#!/usr/bin/env bash
# 分辨率 × 参考图数 全矩阵基准：4 档 megapixels × 1-10 参考图 = 40 用例
# 固定：16:9 / 25 steps（生产档）/ cfg 1.0 / seed 20261001 / 人数约束提示词
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_image/q21_mp_benchmark_20261001"
mkdir -p "$OUT"

STEPS="25"; CFG="1.0"; SEED=20261001
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
declare -A CN=([1]=一 [2]=两 [3]=三 [4]=四 [5]=五 [6]=六 [7]=七 [8]=八 [9]=九 [10]=十)
declare -A EP=([1]=edit [2]=blend [3]=triple_blend [4]=quad_blend [5]=penta_blend [6]=hexa_blend [7]=hepta_blend [8]=octa_blend [9]=nona_blend [10]=deca_blend)

build_desc() {
  local n=$1 desc="" i
  for i in $(seq 1 "$n"); do desc+="${i})${LOOK[$i]}；"; done
  echo "$desc"
}

echo "mp|refs|endpoint|http|seconds|bytes" | tee "$OUT/results.csv"
for MP in 0.5 1.0 1.5 2.0; do
  for N in 1 2 3 4 5 6 7 8 9 10; do
    n="${CN[$N]}"; ep="${EP[$N]}"
    tag="mp${MP}_ref${N}"
    if [ "$N" -eq 1 ]; then
      prompt="把画面中的女人放到漫展大厅里，水平排成一排的合影队列正中间，全身照，互不遮挡。她保持${LOOK[1]}的外貌特征。画面中必须恰好一个女人。"
    else
      desc=$(build_desc "$N")
      prompt="${n}个女人在漫展大厅里水平排成一排开心合影，全身照，人与人之间留有空隙、互不遮挡，每个人都完整可见、正对镜头。从左到右依次是：${desc}画面中必须恰好${n}个女人，一个不多、一个不少，每个人严格对应一张参考图并保持其发型、发色与服装颜色。"
    fi
    args=(-s -o "$OUT/${tag}.png" -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/${ep}")
    args+=(-F "prompt=$prompt" -F "aspect_ratio=$ASPECT" -F "megapixels=$MP" -F "steps=$STEPS" -F "cfg=$CFG" -F "seed=$SEED")
    if [ "$N" -eq 1 ]; then
      args+=(-F "image=@$IN/person_01.png")
    else
      for i in $(seq 1 "$N"); do
        args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png")
      done
    fi
    result=$(curl "${args[@]}")
    size=$(stat -c%s "$OUT/${tag}.png" 2>/dev/null || echo 0)
    echo "$MP|$N|/api/${ep}|$result|$size" | tee -a "$OUT/results.csv"
  done
done
echo DONE
