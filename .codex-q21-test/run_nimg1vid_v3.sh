#!/usr/bin/env bash
# N图+1视频 V3：严格人物隔离提示词 + GENERATION_TIMEOUT=2400
# 核心改进：明确"参考视频仅提供场景/动作，人物全部来自参考图，禁止参考视频人物出现"
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
CI="$HOME/ComfyUI/input"
OUT="output_video/h3_nimg1vid_v3_20261002"
mkdir -p "$OUT"

DUR=5; STEPS=8; MP=0.9; TIMEOUT=2400; SEED=20261002
V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发"   [5]="黄色连帽卫衣、粉色头发"     [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾"   [9]="天蓝色连衣裙、银白色长发"
)
declare -A NUM=([1]=一 [2]=两 [3]=三 [4]=四 [5]=五 [6]=六 [7]=七 [8]=八 [9]=九)

build_strict_prompt() {
  local n=$1
  local num="${NUM[$n]}"

  # 逐人清单
  local roster=""
  for i in $(seq 1 "$n"); do
    roster+="第${i}个人是穿${LOOK[$i]}的女人（来自参考图${i}）"
    if [ "$i" -lt "$n" ]; then
      roster+="，"
    fi
  done

  local p=""

  # ===== 核心指令：人物全部来自参考图，参考视频仅提供场景 =====
  p="生成一段${num}个人的视频。画面中的${num}个人物全部来自${num}张参考图片，"
  p="${p}每个人必须严格保持对应参考图中的发型、发色和服装颜色。"
  p="${p}参考视频1仅用于提供场景背景和动作参考，"
  p="${p}参考视频1中出现的任何原始人物绝对不得出现在生成结果中。"

  # ===== 人物清单 =====
  p="${p}从左到右依次是：${roster}。"

  # ===== 场景与动作 =====
  p="${p}这${num}个人在参考视频1的场景背景中，模仿参考视频1中人物的动作和姿态。"
  p="${p}背景环境、光线、色调与参考视频保持一致。"

  # ===== 严格限制 =====
  p="${p}严格限制："
  p="${p}（1）画面中有且仅有${num}个人，不多不少，从第一帧到最后一帧人数不变；"
  p="${p}（2）所有人的外貌必须与各自的参考图完全一致，不得改变发型、发色或服装；"
  p="${p}（3）不得出现参考视频中原始人物的任何外貌特征，包括帽子、眼镜、发型、服装等配饰；"
  p="${p}（4）不得出现参考视频中的任何原始人物；"
  p="${p}（5）没有人中途消失或突然出现。"

  # ===== 定向补强（基于已验证的失败模式）=====
  case "$n" in
    2) p="${p}特别注意：右边那个人的白色帽子是参考视频原始人物的，不得出现在生成结果中，右边那个人必须穿蓝色牛仔外套、棕色波浪卷发（来自参考图2）。";;
    3) p="${p}特别注意：画面中必须有三个人，第三个人（金色短发、白色衬衫）绝对不能少。";;
    9) p="${p}特别注意：画面中必须有九个人，第九个人（银白色长发、天蓝色连衣裙）绝对不能少。";;
  esac

  echo "$p"
}

echo "case|http|seconds|bytes"
echo "start_time: $(date '+%H:%M:%S')"

for N in 1 2 3 4 5 6 7 8 9; do
  tag="${N}img_1vid_v3"
  prompt=$(build_strict_prompt "$N")
  echo "  [$tag] prompt_len=${#prompt} seed=$SEED"

  local -a args
  args=(curl -s --max-time $TIMEOUT -o "$OUT/${tag}.mp4"
    -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/multi_modal"
    -F "prompt=$prompt" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED")

  for i in $(seq 1 "$N"); do
    args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png")
  done
  args+=(-F "video1=@$CI/$V1")

  result=$("${args[@]}")
  size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  echo "$tag|$result|$size|$(date '+%H:%M:%S')"
  sleep 10
done

echo "end_time: $(date '+%H:%M:%S')"
echo DONE
