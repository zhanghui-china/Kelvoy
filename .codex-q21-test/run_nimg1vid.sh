#!/usr/bin/env bash
# N图+1视频（V1）+0音频：验证"替换参考视频中人物"的效果（N=1~9）
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
CI="$HOME/ComfyUI/input"
OUT="output_video/h3_nimg1vid_20261002"
mkdir -p "$OUT"

DUR=2; SEED=20261001; STEPS=4; MP=0.2; TIMEOUT=600
V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"

declare -A LOOK=(
  [1]="红色连衣裙、黑色长直发" [2]="蓝色牛仔外套、棕色波浪卷发" [3]="白色衬衫配黑色长裙、金色短发"
  [4]="绿色毛衣、黑色齐肩发"   [5]="黄色连帽卫衣、粉色头发"     [6]="紫色旗袍、黑色盘发"
  [7]="橙色飞行员夹克、灰色短发" [8]="黑色西装套裙、深棕色马尾"   [9]="天蓝色连衣裙、银白色长发"
)
declare -A NUM=([1]=一 [2]=两 [3]=三 [4]=四 [5]=五 [6]=六 [7]=七 [8]=八 [9]=九)

build_prompt() {
  local n=$1
  local imgs=""
  for i in $(seq 1 "$n"); do
    imgs+="参考图${i}（${LOOK[$i]}）"
    [ "$i" -lt "$n" ] && imgs+="、"
  done

  if [ "$n" -eq 1 ]; then
    echo "使用${imgs}的人物，生成参考视频1的视频，替换掉参考视频1中左边那个人，右边那个人保持不变，动作和场景与参考视频一致"
  elif [ "$n" -eq 2 ]; then
    echo "使用${imgs}中的两个人物，生成参考视频1的视频，替换掉参考视频1中的2个人，动作和场景与参考视频一致"
  else
    echo "使用${imgs}中的${NUM[$n]}个人物，生成参考视频1的视频，${NUM[$n]}个人都模拟参考视频1中的动作，动作和场景与参考视频一致"
  fi
}

echo "case|prompt_summary|http|seconds|bytes"
for N in 1 2 3 4 5 6 7 8 9; do
  tag="${N}图_1视频_0音频"
  prompt=$(build_prompt "$N")

  local -a args=(curl -s --max-time $TIMEOUT -o "$OUT/${tag}.mp4"
    -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/multi_modal"
    -F "prompt=$prompt" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED")

  for i in $(seq 1 "$N"); do
    args+=(-F "image$i=@$IN/person_$(printf '%02d' "$i").png")
  done
  args+=(-F "video1=@$CI/$V1")

  result=$("${args[@]}")
  size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  echo "$tag|${NUM[$N]}图替换/模拟|$result|$size"
  sleep 5
done
echo DONE
