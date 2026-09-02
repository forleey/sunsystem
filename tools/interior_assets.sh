#!/usr/bin/env bash
# Asset pipeline for the ship interior (spec section 8, plan task 2.1).
#
#   tools/interior_assets.sh            fetch, convert, simplify, write manifest
#   tools/interior_assets.sh --upload   ... and upload to R2 (skips keys already up to date)
#   tools/interior_assets.sh --check    ... and verify every public URL with a HEAD request
#
# Every step is idempotent: work whose output already exists is skipped.
# Everything local lives under models_src/interior/ (gitignored). Nothing is
# written under textures/ or js/ in the repo.
#
# Sources (all CC0, plain curl, no login):
#   Poly Haven textures  https://polyhaven.com   (API: https://api.polyhaven.com/files/<name>)
#   ambientCG textures   https://ambientcg.com   (zip: https://ambientcg.com/get?file=<Id>_2K-JPG.zip)
#   Poly Haven props     glTF 2K, file list from the API
#
# Tools: curl, jq, unzip, python3 with Pillow (channel split, size probe),
#        cwebp (brew install webp), npx @gltf-transform/cli 4.x, npx wrangler (for --upload;
#        wrangler 4 puts into a LOCAL simulation unless --remote is given, hence the flag).

set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/models_src/interior"
RAW="$WORK/raw"
TEX="$WORK/textures"
PROPS="$WORK/props"
MANIFEST="$WORK/manifest.json"

BUCKET="sunsystem-assets"
PUBLIC="https://pub-71534651969246d597a0c1bf543eff8c.r2.dev"
BUDGET_BYTES=$((25 * 1024 * 1024))

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
GT="npx --yes @gltf-transform/cli"

# ---------------------------------------------------------------- sources

PH_TEX_SETS=(metal_plate blue_metal_plate painted_metal_shutter rubber_tiles metal_grate_rusty)
ACG_TEX_SETS=(MetalPlates015A Metal027 DiamondPlate008C MetalWalkway006 Metal046B)

# Sets that go to 1024 px when the total is over budget, in the order they are
# sacrificed. The two named in the task come first; the rest are the
# least-visible surfaces after them (hatch grating, greasy metal, hold floor).
DOWNGRADE_ORDER=(metal_grate_rusty blue_metal_plate MetalWalkway006 Metal046B rubber_tiles)

# Props with their triangle budgets.
PROP_BUDGET=(
  "modular_industrial_pipes_01:20000"
  "modular_electric_cables:20000"
  "modular_airduct_circular_01:12000"
  "power_box_01:8000"
  "vintage_spacecraft_instrument:8000"
  "retro_multimeter:8000"
  "hanging_industrial_lamp:8000"
  "industrial_caged_sconce:8000"
  "mounted_fluorescent_lights:8000"
  "ceiling_fan:8000"
  "old_military_crate:8000"
  "plastic_crate_02:8000"
  "ammo_box:8000"
  "metal_stool_01:8000"
  "portable_generator:20000"
)
# Simplify error bounds, as a fraction of mesh radius, tried in order until the
# prop is within 10 % of its budget. 0.001 is the default; 0.01 is the ceiling
# (still well below what changes a silhouette on a hand-sized prop).
SIMPLIFY_ERRORS=(0.001 0.003 0.01)

# WebP quality per map type.
q_for() { case "$1" in color) echo 82;; normal) echo 90;; *) echo 80;; esac; }

# ---------------------------------------------------------------- flags

DO_UPLOAD=0; DO_CHECK=0
for a in "$@"; do
  case "$a" in
    --upload) DO_UPLOAD=1;;
    --check) DO_CHECK=1;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "unknown flag: $a" >&2; exit 2;;
  esac
done

# ---------------------------------------------------------------- helpers

log() { printf '%s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || { log "missing tool: $1 ($2)"; exit 1; }; }
need curl "system"; need jq "brew install jq"; need unzip "system"
need cwebp "brew install webp"; need python3 "system"; need npx "node"
python3 -c 'import PIL' 2>/dev/null || { log "python3 needs Pillow (pip3 install pillow)"; exit 1; }

# fetch <url> <dest>: two attempts, skip when dest exists and is non-empty.
fetch() {
  local url="$1" dest="$2" i
  [ -s "$dest" ] && return 0
  mkdir -p "$(dirname "$dest")"
  for i in 1 2; do
    if curl -sfL -A "$UA" --retry 2 --connect-timeout 20 -o "$dest.part" "$url"; then
      mv "$dest.part" "$dest"; return 0
    fi
    log "  attempt $i failed: $url"
  done
  rm -f "$dest.part"
  FAILED+=("$url")
  return 1
}
FAILED=()

# img_width <file>
img_width() { python3 -c 'import sys; from PIL import Image; print(Image.open(sys.argv[1]).size[0])' "$1"; }

# split_channel <in> <r|g|b> <out.png>
split_channel() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
im.getchannel({"r": 0, "g": 1, "b": 2}[sys.argv[2]]).save(sys.argv[3])
PY
}

# to_webp <src> <dest> <maptype> <size>
# Skips when dest exists with the requested width. Resizes only when larger.
to_webp() {
  local src="$1" dest="$2" map="$3" size="$4" q w
  if [ -s "$dest" ] && [ "$(img_width "$dest")" = "$size" ]; then return 0; fi
  q="$(q_for "$map")"
  w="$(img_width "$src")"
  mkdir -p "$(dirname "$dest")"
  if [ "$w" -gt "$size" ]; then
    cwebp -quiet -q "$q" -resize "$size" 0 "$src" -o "$dest"
  else
    cwebp -quiet -q "$q" "$src" -o "$dest"
  fi
  log "  wrote $(basename "$dest") ($(stat -f%z "$dest") bytes, ${size} px, q$q)"
}

# tex_size <set>: 2048 unless the set is in the current downgrade list.
# The list is persisted in downgraded.txt so a later run does not rebuild the
# 2048 versions only to shrink them again.
DOWNGRADE_STATE="$WORK/downgraded.txt"
DOWNGRADED=()
if [ -s "$DOWNGRADE_STATE" ]; then
  while read -r s; do [ -n "$s" ] && DOWNGRADED+=("$s"); done < "$DOWNGRADE_STATE"
fi
tex_size() {
  local s; for s in "${DOWNGRADED[@]:-}"; do [ "$s" = "$1" ] && { echo 1024; return; }; done
  echo 2048
}

# ---------------------------------------------------------------- 1. Poly Haven textures

ph_texture_set() {
  local set="$1" api size
  api="$RAW/polyhaven/$set/files.json"
  size="$(tex_size "$set")"
  log "[tex] polyhaven $set ($size px)"
  mkdir -p "$RAW/polyhaven/$set"
  if [ ! -s "$api" ]; then
    curl -sf -A "$UA" -o "$api" "https://api.polyhaven.com/files/$set" || { log "  API failed for $set"; FAILED+=("api:$set"); return; }
  fi
  # Poly Haven key -> our map name
  local pairs=("Diffuse:color" "nor_gl:normal" "Rough:rough" "Metal:metal" "AO:ao")
  local have_metal=0 p key map url src
  for p in "${pairs[@]}"; do
    key="${p%%:*}"; map="${p##*:}"
    url="$(jq -r --arg k "$key" '.[$k]["2k"].jpg.url // empty' "$api")"
    [ -z "$url" ] && continue
    src="$RAW/polyhaven/$set/${set}_${map}_2k.jpg"
    fetch "$url" "$src" || continue
    to_webp "$src" "$TEX/$set/${set}_${map}.webp" "$map" "$size"
    [ "$map" = metal ] && have_metal=1
  done
  # No dedicated metal map: take the blue channel of the ARM (AO, Rough, Metal) pack.
  if [ "$have_metal" = 0 ]; then
    url="$(jq -r '.arm["2k"].jpg.url // empty' "$api")"
    if [ -n "$url" ]; then
      src="$RAW/polyhaven/$set/${set}_arm_2k.jpg"
      if fetch "$url" "$src"; then
        local dest="$TEX/$set/${set}_metal.webp"
        if ! { [ -s "$dest" ] && [ "$(img_width "$dest")" = "$size" ]; }; then
          split_channel "$src" b "$RAW/polyhaven/$set/${set}_metal_from_arm.png"
          to_webp "$RAW/polyhaven/$set/${set}_metal_from_arm.png" "$dest" metal "$size"
          log "  metal split from arm (blue channel)"
        fi
        NOTES+=("$set: no metal map at Poly Haven, metal taken from arm blue channel")
      fi
    else
      NOTES+=("$set: no metal map and no arm map, metal omitted")
    fi
  fi
}

# ---------------------------------------------------------------- 2. ambientCG textures

acg_texture_set() {
  local id="$1" dir zip size
  dir="$RAW/ambientcg/$id"; zip="$RAW/ambientcg/${id}_2K-JPG.zip"
  size="$(tex_size "$id")"
  log "[tex] ambientcg $id ($size px)"
  fetch "https://ambientcg.com/get?file=${id}_2K-JPG.zip" "$zip" || return 0
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    unzip -q -o -j "$zip" -d "$dir" '*.jpg' '*.JPG' '*.png' '*.PNG' 2>/dev/null || true
  fi
  local pairs=("Color:color" "NormalGL:normal" "Roughness:rough" "Metalness:metal" "AmbientOcclusion:ao" "Opacity:opacity")
  local p suffix map src
  for p in "${pairs[@]}"; do
    suffix="${p%%:*}"; map="${p##*:}"
    src="$(ls "$dir"/*_"$suffix".jpg "$dir"/*_"$suffix".png 2>/dev/null | head -n1 || true)"
    [ -z "$src" ] && continue
    to_webp "$src" "$TEX/$id/${id}_${map}.webp" "$map" "$size"
  done
  [ -e "$TEX/$id/${id}_metal.webp" ] || NOTES+=("$id: ambientCG ships no Metalness map for this set")
}

# ---------------------------------------------------------------- 3. props

# triangles <glb-or-gltf>: sum of glPrimitives * instances from inspect csv.
triangles() {
  # (no early exit in awk: with pipefail a SIGPIPE to npx would abort the script)
  { $GT inspect "$1" --format csv 2>/dev/null || true; } | awk -F',' '
    /^ MESHES/ {inm=1; next}
    /^ [A-Z]/ && !/^ MESHES/ {inm=0}
    inm && /^#,name/ {next}
    inm && $3=="TRIANGLES" {tri+=$5*$(NF-1)}
    END {print tri+0}'
}

prop() {
  local name="$1" budget="$2" dir api out
  dir="$RAW/props/$name"; api="$dir/files.json"; out="$PROPS/$name.glb"
  log "[prop] $name (budget $budget tris)"
  [ -s "$out" ] && { log "  exists, skip"; return 0; }
  mkdir -p "$dir"
  if [ ! -s "$api" ]; then
    curl -sf -A "$UA" -o "$api" "https://api.polyhaven.com/files/$name" || { log "  API failed for $name"; FAILED+=("api:$name"); return 0; }
  fi
  local gltf_url gltf
  gltf_url="$(jq -r '.gltf["2k"].gltf.url // empty' "$api")"
  [ -z "$gltf_url" ] && { log "  no gltf 2k entry for $name"; NOTES+=("$name: no glTF 2K entry at Poly Haven"); return 0; }
  gltf="$dir/$(basename "$gltf_url")"
  fetch "$gltf_url" "$gltf" || return 0
  # includes: key is the path relative to the .gltf, value.url the download
  local n_fail=0
  while IFS=$'\t' read -r rel url; do
    fetch "$url" "$dir/$rel" || n_fail=$((n_fail+1))
  done < <(jq -r '.gltf["2k"].gltf.include | to_entries[] | "\(.key)\t\(.value.url)"' "$api")
  [ "$n_fail" -gt 0 ] && { log "  $n_fail include(s) missing, skipping $name"; return 0; }

  local tmp="$dir/_work" src_tris ratio err got
  rm -rf "$tmp"; mkdir -p "$tmp"
  src_tris="$(triangles "$gltf")"
  ratio="$(python3 -c "import sys; b=float(sys.argv[1]); t=float(sys.argv[2]); print(f'{min(1.0, b/t):.4f}' if t>0 else '1.0')" "$budget" "$src_tris")"
  log "  source $src_tris tris, ratio $ratio"
  $GT weld "$gltf" "$tmp/1.glb" >/dev/null
  if [ "$ratio" != "1.0000" ]; then
    for err in "${SIMPLIFY_ERRORS[@]}"; do
      $GT simplify "$tmp/1.glb" "$tmp/2.glb" --ratio "$ratio" --error "$err" >/dev/null
      got="$(triangles "$tmp/2.glb")"
      log "  simplify error $err: $got tris"
      [ "$got" -le $((budget * 11 / 10)) ] && break
    done
    [ "$got" -gt $((budget * 11 / 10)) ] && NOTES+=("$name: $got tris after simplify at error $err, budget $budget (error bound reached)")
  else
    cp "$tmp/1.glb" "$tmp/2.glb"
  fi
  $GT dedup "$tmp/2.glb" "$tmp/3.glb" >/dev/null
  $GT prune "$tmp/3.glb" "$tmp/4.glb" >/dev/null
  $GT resize "$tmp/4.glb" "$tmp/5.glb" --width 1024 --height 1024 >/dev/null
  $GT webp "$tmp/5.glb" "$tmp/6.glb" >/dev/null
  mkdir -p "$PROPS"
  $GT meshopt "$tmp/6.glb" "$out" >/dev/null
  rm -rf "$tmp"
  log "  wrote $name.glb: $(triangles "$out") tris, $(stat -f%z "$out") bytes"
}

# ---------------------------------------------------------------- 4. manifest

write_manifest() {
  local total=0 set f name bytes maps tris
  local tex_json="{}" prop_json="{}"
  for set in "${PH_TEX_SETS[@]}" "${ACG_TEX_SETS[@]}"; do
    [ -d "$TEX/$set" ] || continue
    bytes=0; maps="[]"
    for f in "$TEX/$set"/*.webp; do
      [ -e "$f" ] || continue
      bytes=$((bytes + $(stat -f%z "$f")))
      maps="$(jq -c --arg m "$(basename "$f" .webp | sed "s/^${set}_//")" '. + [$m]' <<<"$maps")"
    done
    total=$((total + bytes))
    tex_json="$(jq -c --arg s "$set" --argjson m "$maps" --argjson b "$bytes" --argjson px "$(tex_size "$set")" \
      '.[$s] = {maps: $m, bytes: $b, px: $px}' <<<"$tex_json")"
  done
  for f in "$PROPS"/*.glb; do
    [ -e "$f" ] || continue
    name="$(basename "$f" .glb)"; bytes="$(stat -f%z "$f")"; tris="$(triangles "$f")"
    total=$((total + bytes))
    prop_json="$(jq -c --arg n "$name" --argjson t "$tris" --argjson b "$bytes" '.[$n] = {triangles: $t, bytes: $b}' <<<"$prop_json")"
  done
  jq -n --argjson t "$tex_json" --argjson p "$prop_json" --argjson total "$total" \
    '{textures: $t, props: $p, totalBytes: $total}' > "$MANIFEST"
  TOTAL_BYTES="$total"
}

# ---------------------------------------------------------------- 5. upload / check

# key_for <local file>
key_for() {
  local f="$1"
  case "$f" in
    "$TEX"/*) echo "textures/interior/${f#"$TEX"/}";;
    "$PROPS"/*) echo "models/interior/${f#"$PROPS"/}";;
  esac
}
mime_for() { case "$1" in *.webp) echo image/webp;; *.glb) echo model/gltf-binary;; esac; }

all_files() {
  find "$TEX" -name '*.webp' -type f 2>/dev/null | sort
  find "$PROPS" -name '*.glb' -type f 2>/dev/null | sort
}

# remote_len <key>: content-length of the public object, or empty
remote_len() { curl -sI "$PUBLIC/$1" | awk 'BEGIN{IGNORECASE=1} /^HTTP/ {code=$2} /^content-length:/ {gsub("\r","",$2); len=$2} END {if (code=="200") print len}'; }

upload() {
  local f key local_len remote
  while read -r f; do
    key="$(key_for "$f")"; local_len="$(stat -f%z "$f")"
    remote="$(remote_len "$key")"
    if [ "$remote" = "$local_len" ]; then log "[r2] up to date: $key"; continue; fi
    log "[r2] put $key ($local_len bytes)"
    npx wrangler r2 object put "$BUCKET/$key" --remote --file "$f" --content-type "$(mime_for "$f")" >/dev/null
  done < <(all_files)
}

check() {
  local f key code len ok=0 bad=0
  printf '\n%-60s %6s %10s\n' "key" "status" "bytes"
  printf '%-60s %6s %10s\n' "$(printf '%.0s-' {1..60})" "------" "----------"
  while read -r f; do
    key="$(key_for "$f")"
    read -r code len < <(curl -sI "$PUBLIC/$key" | awk 'BEGIN{IGNORECASE=1} /^HTTP/ {code=$2} /^content-length:/ {gsub("\r","",$2); len=$2} END {print code, len}')
    printf '%-60s %6s %10s\n' "$key" "$code" "${len:-}"
    if [ "$code" = 200 ]; then ok=$((ok+1)); else bad=$((bad+1)); fi
  done < <(all_files)
  printf '\n%d ok, %d failed\n' "$ok" "$bad"
  [ "$bad" = 0 ]
}

# ---------------------------------------------------------------- main

NOTES=()
mkdir -p "$RAW" "$TEX" "$PROPS"

run_textures() {
  local s
  for s in "${PH_TEX_SETS[@]}"; do ph_texture_set "$s"; done
  for s in "${ACG_TEX_SETS[@]}"; do acg_texture_set "$s"; done
}

run_textures
for e in "${PROP_BUDGET[@]}"; do prop "${e%%:*}" "${e##*:}"; done
write_manifest

# Over budget: downgrade sets to 1024 one at a time, in DOWNGRADE_ORDER, until under.
for s in "${DOWNGRADE_ORDER[@]}"; do
  [ "$TOTAL_BYTES" -le "$BUDGET_BYTES" ] && break
  already=0; for d in "${DOWNGRADED[@]:-}"; do [ "$d" = "$s" ] && already=1; done
  [ "$already" = 1 ] && continue
  log "[budget] $TOTAL_BYTES > $BUDGET_BYTES: dropping $s to 1024 px"
  DOWNGRADED+=("$s")
  printf '%s\n' "${DOWNGRADED[@]}" > "$DOWNGRADE_STATE"
  run_textures
  write_manifest
done

log ""
log "manifest: $MANIFEST"
log "total: $TOTAL_BYTES bytes ($(python3 -c "print(f'{$TOTAL_BYTES/1048576:.2f}')") MB), budget $BUDGET_BYTES"
[ "${#DOWNGRADED[@]}" -gt 0 ] && log "downgraded to 1024 px: ${DOWNGRADED[*]}"
[ "$TOTAL_BYTES" -gt "$BUDGET_BYTES" ] && log "WARNING: still over budget after all downgrades"
for n in "${NOTES[@]:-}"; do [ -n "$n" ] && log "note: $n"; done
for u in "${FAILED[@]:-}"; do [ -n "$u" ] && log "FAILED download: $u"; done

[ "$DO_UPLOAD" = 1 ] && upload
[ "$DO_CHECK" = 1 ] && check
exit 0
