#!/usr/bin/env bash
# 修复 N图+1视频 中人数不正确的 4 个用例（N=3,5,7,9）
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
CI="$HOME/ComfyUI/input"
OUT="output_video/h3_nimg1vid_20261002"

DUR=2; STEPS=4; MP=0.2; TIMEOUT=600; SEED=20261001
V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发"   [5]="黄色连帽卫衣、粉色头发"     [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾"   [9]="天蓝色连衣裙、银白色长发"
)
declare -A NUM=([3]=三 [5]=五 [7]=七 [9]=九)

build_enhanced_prompt() {
  local n=$1
  local imgs=""
  for i in $(seq 1 "$n"); do
    imgs+="参考图${i}（${LOOK[$i]}）"
    [ "$i" -lt "$n" ] && imgs+="、"
  done

  local num="${NUM[$n]}"

  # 共通骨架：逐人点名 + 水平排开 + 严格人数 + 不消失
  local p="使用${imgs}中的${num}个人物，生成一段${num}个人一起模仿参考视频1中动作的视频。"
  p="${p}${num}个人水平排成一排站立，从左到右依次是："
  for i in $(seq 1 "$n"); do
    p="${p}第${i}个是${LOOK[$i]}的女人"
    [ "$i" -lt "$n" ] && p="${p}、"
  done
  p="${p}。画面中必须恰好${num}个女人，从第一帧到最后一帧都是${num}个人，一个不能少、一个不能多、任何人都不能中途消失或突然出现。每个人都严格保持自己参考图中的发型、发色和服装颜色。"

  # 针对具体失败模式加强
  case "$n" in
    3)
      p="${p}特别注意：画面中是三个不同的女人，不是两个，确保第三个人（金色短发、白色衬衫的女人）清晰可见。"
      ;;
    5)
      p="${p}特别注意：画面中只有五个女人，不要出现第六个人，不要出现参考视频中的原始人物。"
      ;;
    7)
      p="${p}特别注意：画面中始终是七个人，不要多也不要少，所有人从第一帧到最后一帧都完整可见，不要有人中途消失。"
      ;;
    9)
      p="${p}特别注意：画面中是九个女人，不是八个，确保第九个人（银白色长发、天蓝色连衣裙的女人）清晰可见且完整。"
      ;;
  esac
  echo "$p"
}

echo "case|http|seconds|bytes"
for N in 3 5 7 9; do
  tag="${N}图_1视频_0音频_v2"
  prompt=$(build_enhanced_prompt "$N")
  seed=$((SEED + N * 100))  # 换 seed 避免同种子偏差

  local -a args 2>/dev/null || true
  args=(curl -s --max-time $TIMEOUT -o "$OUT/${tag}.mp4"
    -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/multi_modal"
    -F "prompt=$prompt" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$seed")

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
