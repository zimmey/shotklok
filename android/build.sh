#!/usr/bin/env bash
# Builds shotklok.apk with the bare SDK tools (no Gradle).
# Usage: android/build.sh <keystore> <storepass> [out.apk]
set -euo pipefail
cd "$(dirname "$0")"

KEYSTORE=$1
STOREPASS=$2
OUT=${3:-../shotklok.apk}

SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
PLATFORM=$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)
JAR=$PLATFORM/android.jar

rm -rf build && mkdir -p build/classes build/dex
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$JAR" --manifest AndroidManifest.xml build/res.zip
javac -source 8 -target 8 -bootclasspath "$JAR" -d build/classes $(find src -name '*.java')
"$BT/d8" --min-api 21 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$STOREPASS" --out "$OUT" build/aligned.apk
echo "Built $OUT"
