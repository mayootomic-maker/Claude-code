#!/bin/bash
# compare.sh SHOT tag ref_t1 ref_t2 ref_t3 f1 f2 f3
# Builds a 2x3 sheet: reference frames on top, renders below.
set -e
SHOT=$1; TAG=$2; T1=$3; T2=$4; T3=$5; F1=$6; F2=$7; F3=$8
R=/home/user/Claude-code/reference/koenigsegg_reference.mp4
P=/home/user/Claude-code/project/previews/$TAG
O=/home/user/Claude-code/project/previews/compare
mkdir -p $O /tmp/cmp
for i in 1 2 3; do
  eval T=\$T$i
  ffmpeg -nostdin -hide_banner -loglevel error -ss $T -i $R -frames:v 1 -vf "scale=960:540" -q:v 2 /tmp/cmp/ref$i.jpg -y
done
ffmpeg -nostdin -hide_banner -loglevel error \
  -i /tmp/cmp/ref1.jpg -i /tmp/cmp/ref2.jpg -i /tmp/cmp/ref3.jpg \
  -i $P/${SHOT}_$(printf %04d $F1).png -i $P/${SHOT}_$(printf %04d $F2).png -i $P/${SHOT}_$(printf %04d $F3).png \
  -filter_complex "[0:v][1:v][2:v][3:v][4:v][5:v]xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0" \
  -frames:v 1 -q:v 2 $O/${SHOT}.jpg -y
echo "$O/${SHOT}.jpg"
