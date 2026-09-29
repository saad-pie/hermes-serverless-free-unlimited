#!/usr/bin/env bash
# Honesty probe for an OpenAI-compatible router.
# Usage: ./scripts/honesty-probe.sh [base_url] [token]
#   base_url defaults to $ANTIGRAVITY_URL or http://localhost:3000
#   token    defaults to $ANTIGRAVITY_TOKEN or "antigravity-free"

set -u

BASE="${1:-${ANTIGRAVITY_URL:-http://localhost:3000}}"
TOKEN="${2:-${ANTIGRAVITY_TOKEN:-antigravity-free}}"

SENTINEL="ZQ$(date +%s)"
MODELS="${MODELS:-gpt-oss-120b gpt-oss-20b gemini-2.5-flash gemini-flash-latest glm-5.3-flash glm-5.3-flash:free qwen3.6-plus qwen3.6-plus:free kimi-k3:free deepseek-v4-flash:free deepseek-v4-flash}"

printf '%-28s %-26s %-12s %-9s %s\n' MODEL RETURNED VERDICT HTTP SENTINEL
printf '%s\n' "--------------------------------------------------------------------------------"

for m in $MODELS; do
  payload=$(cat <<JSON
{"model":"$m","messages":[{"role":"user","content":"Reply with exactly this token and nothing else: $SENTINEL"}],"max_tokens":40}
JSON
)

  tmp=$(mktemp)
  http=$(curl -sS --max-time 15 -o "$tmp" -w '%{http_code}' \
    "$BASE/v1/chat/completions" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "$payload") || http="000"

  raw=$(cat "$tmp"); rm -f "$tmp"

  # Try to parse JSON
  parsed=$(printf '%s' "$raw" | node -e '
    let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
      try{const j=JSON.parse(d);
        const out={
          model: j.model||"",
          content: j.choices?.[0]?.message?.content||"",
          err: j.error?.message||"",
        };
        process.stdout.write(JSON.stringify(out));
      }catch(e){process.stdout.write(JSON.stringify({parse_fail:true,prefix:d.slice(0,120)}));}
    });' 2>/dev/null)

  returned=$(printf '%s' "$parsed" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.model||"<none>")}catch{process.stdout.write("<parse_fail>")}});')
  content=$(printf '%s' "$parsed" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.content||"")}catch{process.stdout.write("")}});')
  errmsg=$(printf '%s' "$parsed" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.err||"")}catch{process.stdout.write("")}});')

  # Determine verdict
  verdict="OK"
  sentinel="no"

  case "$returned" in
    "<parse_fail>") verdict="PARSE_FAIL";;
    "<none>")       verdict="NO_MODEL";;
  esac

  if [ "$verdict" = "OK" ]; then
    req_base="${m%%:*}"
    ret_base="${returned%%/*}"
    ret_base="${ret_base##*/}"
    if [ "$returned" = "$m" ] || [ "$ret_base" = "$req_base" ]; then
      :
    else
      verdict="SUBSTITUTED"
    fi
  fi

  # Detect obvious canned fallbacks from the old handler
  case "$content" in
    *"1x1 transparent PNG"*)  verdict="CANNED_FALLBACK";;
    *"All systems operational"*) verdict="CANNED_FALLBACK";;
  esac

  # Sentinel check
  case "$content" in
    *"$SENTINEL"*) sentinel="yes";;
  esac

  # If sentinel missing but we got a 200, flag it
  if [ "$verdict" = "OK" ] && [ "$sentinel" = "no" ] && [ -n "$content" ]; then
    verdict="NO_SENTINEL"
  fi

  printf '%-28s %-26s %-12s %-9s %s\n' "$m" "${returned:-<empty>}" "$verdict" "$http" "$sentinel"

  if [ -n "$errmsg" ]; then
    printf '   error: %s\n' "$errmsg"
  fi
done
