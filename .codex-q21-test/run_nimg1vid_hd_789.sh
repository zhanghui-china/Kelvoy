#!/usr/bin/env bash
# 7-9 图 0.9MP 超时重试（GENERATION_TIMEOUT=1800, curl max-time 1800）
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
CI="$HOME/ComfyUI/input"
OUT="output_video/h3_nimg1vid_hd_20261002"

DUR=5; STEPS=8; MP=0.9; TIMEOUT=1800; SEED=20261001
V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发"   [5]="黄色连帽卫衣、粉色头发"     [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾"   [9]="天蓝色连衣裙、银白色长发"
)
declare -A NUM=([7]=七 [8]=八 [9]=九)

echo "case|http|seconds|bytes"
for N in 7 8 9; do
  tag="${N}img_1vid_0aud_hd"
  num="${NUM[$N]}"
  imgs=""
  for i in $(seq 1 "$N"); do
    imgs+="参考图${i}（${LOOK[$i]}）"
    [ "$i" -lt "$N" ] && imgs+="、"
  done
  p="使用${imgs}的${num}个人物，在参考视频1的原始场景中，模仿参考视频中人物的动作。背景环境、光线、拍摄角度与参考视频完全一致，不要改变场景。画面中必须恰好${num}个女人，从第一帧到最后一帧人数不变。"
  case "$N" in
    7) p="${p}七个人从第一帧到最后一帧都完整可见，没有人中途消失。";;
    9) p="${p}第九个人（银白色长发、天蓝色连衣裙）必须清晰可见。";;
  esac

  local -a args
  args=(curl -s --max-time $TIMEOUT -o "$OUT/${tag}.mp4"
    -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/multi_modal"
    -F "prompt=$p" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED")
  for i in $(seq 1 "$N"); do
    args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png")
  done
  args+=(-F "video1=@$CI/$V1")

  result=$("${args[@]}")
  size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  echo "$tag|$result|$size"
  sleep 5
done
echo DONE
