#!/usr/bin/env bash
# 3参考图 + 3音频（三个人声）多模态生成测试
# 参考图: person_01(红裙) person_02(蓝牛仔) person_03(白衬衫)
# 音频: 张辉(男声) 小团团(女声童音) 林志玲(女声温柔)
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_video/h3_3img3aud_20261002"
mkdir -p "$OUT"

DUR=5; STEPS=8; SEED=20261002; TIMEOUT=3600

echo "=========================================="
echo "3图+3音频 多模态视频生成测试"
echo "图片: person_01(红裙) person_02(蓝牛仔) person_03(白衬衫)"
echo "音频: 张辉(男声) 小团团(女声) 林志玲(女声)"
echo "参数: ${DUR}s · MP=0.6 · steps=$STEPS · seed=$SEED"
echo "=========================================="

run_case() {
  local id=$1 mp=$2 prompt=$3
  local tag="${id}_mp${mp}"
  echo ""
  echo "[$tag] prompt: ${prompt:0:60}..."
  local -a args
  args=(curl -s --max-time $TIMEOUT -o "$OUT/${tag}.mp4"
    -w "%{http_code} %{time_total}" -X POST "$BRIDGE/api/video/multi_modal"
    -F "prompt=$prompt" -F "duration=$DUR" -F "megapixels=$mp" -F "steps=$STEPS" -F "seed=$SEED"
    -F "image1=@$IN/person_01.png" -F "image2=@$IN/person_02.png" -F "image3=@$IN/person_03.png"
    -F "audio1=@$IN/voice_zhanghui.m4a"
    -F "audio2=@$IN/voice_xiaotuantuan.m4a"
    -F "audio3=@$IN/voice_linzhiling.m4a")
  local result
  result=$("${args[@]}")
  local size
  size=$(stat -c%s "$OUT/${tag}.mp4" 2>/dev/null || echo 0)
  echo "$tag|$result|$size"
  sleep 5
}

echo "case|http|seconds|bytes"

# 场景1: 三个女人分别对应三个声音进行对话/歌唱
run_case "01_dialog" 0.6 \
  "使用参考图1（红色连衣裙、黑色长直发的女人）、参考图2（蓝色牛仔外套、棕色波浪卷发的女人）和参考图3（白色衬衫配黑色长裙、金色短发的女人），生成一段三人对话的视频。三个女人站在一起聊天，参考音频1（男声）是背景旁白，参考音频2（女声）和参考音频3（女声）分别是其中两个人的说话声音。背景是一个明亮的客厅。画面中有且仅有三个人，外貌与参考图完全一致。"

# 场景2: 三个女人合唱，音频作为背景音乐
run_case "02_choir" 0.6 \
  "使用参考图1（红色连衣裙的女人）、参考图2（蓝色牛仔外套的女人）和参考图3（白色衬衫配黑色长裙的女人），生成一段三人合唱的视频。三个女人并排站立唱歌，嘴巴动作与音频节奏同步。参考音频提供歌曲的声音，三个人都张嘴唱歌。背景是一个舞台。画面中有且仅有三个人，从第一帧到最后一帧人数不变。"

# 场景3: 0.9MP 高清版对话（如果 0.6 成功则测试更高画质）
run_case "03_dialog_hd" 0.9 \
  "使用参考图1（红色连衣裙、黑色长直发的女人）、参考图2（蓝色牛仔外套、棕色波浪卷发的女人）和参考图3（白色衬衫配黑色长裙、金色短发的女人），生成一段三人对话的视频。三个女人站在一起聊天，参考音频提供对话的声音和背景音。背景是一个明亮的客厅。画面中有且仅有三个人，外貌与参考图完全一致。"

echo ""
echo "DONE"
