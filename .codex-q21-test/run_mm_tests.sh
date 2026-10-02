#!/usr/bin/env bash
# MiniMax-H3 多模态参考生视频测试：9图+3视频+3音频 ≤ 12 文件
set -u
cd "$(dirname "$0")"
BRIDGE="http://127.0.0.1:6000"
IN="input"
OUT="output_video/h3_multimodal_20261001"
mkdir -p "$OUT"

DUR=2; MP=0.2; STEPS=4; SEED=20261001
V1="4df66933bbd4f0311bc002097151fc21a0fd035bd134f4b656527c028ec4c30c.mp4"
V2="7月2日 (1).mp4"
V3="MiniMax_H3_sage_smoke_test_cached_00001_.mp4"
A1="q21_speech.mp3"; A2="ref_S1.mp3"; A3="ref_S2.mp3"

img_args() { # $1..$N = count
  local n=$1 out=""; shift
  for i in $(seq 1 "$n"); do out+="-F image$i=@$IN/person_$(printf '%02d' "$i").png "; done
  echo "$out"
}

echo "case|http|seconds|bytes"

# 边界校验（用文件名引用，不上传文件，不触发生成）
r=$(curl -s --max-time 15 -o /dev/null -w "%{http_code}" -X POST "$BRIDGE/api/video/multi_modal" -F "prompt=x" $(for i in $(seq 1 10); do printf -- "-F image$i=person_%02d.png " "$i"; done)); echo "limit_10img|$r|0|0"
r=$(curl -s --max-time 15 -o /dev/null -w "%{http_code}" -X POST "$BRIDGE/api/video/multi_modal" -F "prompt=x" -F "video1=$V1" -F "video2=$V2" -F "video3=$V3" -F "video4=$A1"); echo "limit_4video|$r|0|0"
r=$(curl -s --max-time 15 -o /dev/null -w "%{http_code}" -X POST "$BRIDGE/api/video/multi_modal" -F "prompt=x" $(for i in $(seq 1 10); do printf -- "-F image$i=person_%02d.png " "$i"; done) -F "video1=$V1" -F "video2=$V2" -F "video3=$V3"); echo "limit_13files|$r|0|0"

# 用例1: 1图+1视频
curl -s -o "$OUT/mm_1i1v.mp4" -w "mm_1i1v|%{http_code} %{time_total}|%{size_download}\n" -X POST "$BRIDGE/api/video/multi_modal" \
  -F "image1=@$IN/person_01.png" -F "video1=@$HOME/ComfyUI/input/$V1" \
  -F "prompt=参考图中的女性在参考视频的场景中漫步" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED"

# 用例2: 1图+1视频+1音频
curl -s -o "$OUT/mm_1i1v1a.mp4" -w "mm_1i1v1a|%{http_code} %{time_total}|%{size_download}\n" -X POST "$BRIDGE/api/video/multi_modal" \
  -F "image1=@$IN/person_02.png" -F "video1=@$HOME/ComfyUI/input/$V2" -F "audio1=@$HOME/ComfyUI/input/$A1" \
  -F "prompt=参考图中的女性伴随音乐起舞" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED"

# 用例3: 3图+2视频+2音频
curl -s -o "$OUT/mm_3i2v2a.mp4" -w "mm_3i2v2a|%{http_code} %{time_total}|%{size_download}\n" -X POST "$BRIDGE/api/video/multi_modal" \
  $(img_args 3) -F "video1=@$HOME/ComfyUI/input/$V1" -F "video2=@$HOME/ComfyUI/input/$V2" \
  -F "audio1=@$HOME/ComfyUI/input/$A1" -F "audio2=@$HOME/ComfyUI/input/$A2" \
  -F "prompt=三位参考图中的女性在两段参考视频的场景中欢聚" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED"

# 用例4: 满配 9图+3视频+3音频 = 12 文件
curl -s -o "$OUT/mm_9i3v3a.mp4" -w "mm_9i3v3a|%{http_code} %{time_total}|%{size_download}\n" -X POST "$BRIDGE/api/video/multi_modal" \
  $(img_args 9) -F "video1=@$HOME/ComfyUI/input/$V1" -F "video2=@$HOME/ComfyUI/input/$V2" -F "video3=@$HOME/ComfyUI/input/$V3" \
  -F "audio1=@$HOME/ComfyUI/input/$A1" -F "audio2=@$HOME/ComfyUI/input/$A2" -F "audio3=@$HOME/ComfyUI/input/$A3" \
  -F "prompt=九位参考图中的女性和多段参考视频角色一起欢庆，配合参考音频的节奏" -F "duration=$DUR" -F "megapixels=$MP" -F "steps=$STEPS" -F "seed=$SEED"
echo DONE
