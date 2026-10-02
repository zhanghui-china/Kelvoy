#!/usr/bin/env bash
# N图+1视频 全面测试（0.9MP · 5s · 8steps 生产档）
# 关键改进：强制保留参考视频的背景环境 + 严格人数约束
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
CI="$HOME/ComfyUI/input"
OUT="output_video/h3_nimg1vid_hd_20261002"
mkdir -p "$OUT"

DUR=5; STEPS=8; MP=0.9; TIMEOUT=1200; SEED=20261001
V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发"   [5]="黄色连帽卫衣、粉色头发"     [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾"   [9]="天蓝色连衣裙、银白色长发"
)
declare -A NUM=([1]=一 [2]=两 [3]=三 [4]=四 [5]=五 [6]=六 [7]=七 [8]=八 [9]=九)

build_prompt() {
  local n=$1
  local num="${NUM[$n]}"
  local imgs=""
  for i in $(seq 1 "$n"); do
    imgs+="参考图${i}（${LOOK[$i]}）"
    [ "$i" -lt "$n" ] && imgs+="、"
  done

  local p=""
  if [ "$n" -eq 1 ]; then
    p="使用${imgs}的人物，在参考视频1的原始场景中，替换掉参考视频1中左边那个人。右边那个人保持不变，整个背景环境、光线、拍摄角度与参考视频完全一致。"
  elif [ "$n" -eq 2 ]; then
    p="使用${imgs}的两个人物，在参考视频1的原始场景中，替换掉参考视频1中的两个人。背景环境、光线、拍摄角度与参考视频完全一致。"
  else
    p="使用${imgs}的${num}个人物，在参考视频1的原始场景中，模仿参考视频中人物的动作。"
    p="${p}背景环境、光线、拍摄角度与参考视频完全一致，不要改变场景。"
  fi

  # 人数约束（不过度强调排队，避免丢失场景）
  p="${p}画面中必须恰好${num}个女人，从第一帧到最后一帧人数不变。"

  # 针对已知失败模式定向补强
  case "$n" in
    3) p="${p}第三个人（金色短发、白色衬衫）必须清晰可见。";;
    5) p="${p}不要出现第六个人，不要出现参考视频中的原始人物。";;
    7) p="${p}七个人从第一帧到最后一帧都完整可见，没有人中途消失。";;
    9) p="${p}第九个人（银白色长发、天蓝色连衣裙）必须清晰可见。";;
  esac
  echo "$p"
}

echo "case|http|seconds|bytes"
for N in 1 2 3 4 5 6 7 8 9; do
  tag="${N}img_1vid_0aud_hd"
  prompt=$(build_prompt "$N")

  # 打印提示词摘要供日志审查
  echo "  [$tag] prompt: ${prompt:0:80}..."

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
  echo "$tag|$result|$size"
  sleep 5
done
echo DONE
