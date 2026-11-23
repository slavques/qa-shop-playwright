#!/usr/bin/env bash
set -euo pipefail

: "${GF_SECURITY_ADMIN_PASSWORD:?Set GF_SECURITY_ADMIN_PASSWORD to a unique password}"
: "${GRAFANA_PUBLIC_DASHBOARD_TOKEN:?Set GRAFANA_PUBLIC_DASHBOARD_TOKEN to a stable 32-character hexadecimal token}"
export GF_AUTH_ANONYMOUS_ENABLED=false

target=${SHOP_METRICS_TARGET:-shop:3000}
scheme=${SHOP_METRICS_SCHEME:-http}
if [[ ! "$target" =~ ^[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo 'SHOP_METRICS_TARGET must be a hostname and optional port' >&2
  exit 1
fi
if [[ "$scheme" != http && "$scheme" != https ]]; then
  echo 'SHOP_METRICS_SCHEME must be http or https' >&2
  exit 1
fi
if [[ ! "$GRAFANA_PUBLIC_DASHBOARD_TOKEN" =~ ^[a-f0-9]{32}$ ]]; then
  echo 'GRAFANA_PUBLIC_DASHBOARD_TOKEN must be 32 lowercase hexadecimal characters' >&2
  exit 1
fi

runtime_directory=$(mktemp -d)
process_ids=()

cleanup() {
  if ((${#process_ids[@]})); then
    kill "${process_ids[@]}" 2>/dev/null || true
    wait "${process_ids[@]}" 2>/dev/null || true
  fi
  rm -f "$runtime_directory/prometheus.yml" "$runtime_directory/share.json"
  rmdir "$runtime_directory"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

sed -e 's|^  - alerts.yml$|  - /etc/qa-shop/prometheus/alerts.yml|' \
    -e "s|shop:3000|$target|" \
    -e "s|scheme: http|scheme: $scheme|" \
    /etc/qa-shop/prometheus/prometheus.yml > "$runtime_directory/prometheus.yml"
promtool check config "$runtime_directory/prometheus.yml"

prometheus \
  --config.file="$runtime_directory/prometheus.yml" \
  --storage.tsdb.path="${GF_PATHS_DATA}/prometheus" \
  --web.listen-address=127.0.0.1:9090 \
  --query.max-concurrency=4 \
  --query.max-samples=500000 &
process_ids+=("$!")

/run.sh &
process_ids+=("$!")

grafana_api() {
  local credentials
  credentials=$(printf '%s:%s' "${GF_SECURITY_ADMIN_USER:-admin}" "$GF_SECURITY_ADMIN_PASSWORD" | base64 | tr -d '\n')
  printf 'header = "Authorization: Basic %s"\n' "$credentials" | \
    curl --config - --silent --show-error --connect-timeout 2 --max-time 5 "$@"
}

grafana=http://127.0.0.1:3000
dashboard_api="$grafana/api/dashboards/uid/qa-shop-observability"
for attempt in {1..60}; do
  if curl --fail --silent --max-time 2 "$grafana/api/health" >/dev/null; then
    dashboard_status=$(grafana_api --output /dev/null --write-out '%{http_code}' "$dashboard_api")
    case "$dashboard_status" in
      200) break ;;
      404|503) ;;
      *)
        echo "Grafana could not read the provisioned dashboard (HTTP $dashboard_status)" >&2
        exit 1
        ;;
    esac
  fi
  if ! kill -0 "${process_ids[@]}" 2>/dev/null || ((attempt == 60)); then
    echo 'Monitoring and the provisioned dashboard did not become ready' >&2
    exit 1
  fi
  sleep 1
done

share_api="$dashboard_api/public-dashboards/"
share_status=$(grafana_api --output "$runtime_directory/share.json" --write-out '%{http_code}' "$share_api")
case "$share_status" in
  200)
    if ! jq -e --arg access "$GRAFANA_PUBLIC_DASHBOARD_TOKEN" \
        '.isEnabled and .accessToken == $access' "$runtime_directory/share.json" >/dev/null; then
      echo 'Existing dashboard share differs from the configured token or is disabled' >&2
      exit 1
    fi
    ;;
  404)
    share_payload=$(jq -n --arg access "$GRAFANA_PUBLIC_DASHBOARD_TOKEN" \
      '{accessToken: $access, isEnabled: true, timeSelectionEnabled: true, annotationsEnabled: false, share: "public"}')
    grafana_api --fail --json "$share_payload" "$share_api" >/dev/null
    ;;
  *)
    echo "Grafana could not read the dashboard sharing settings (HTTP $share_status)" >&2
    exit 1
    ;;
esac

curl --fail --silent --show-error --max-time 5 \
  "$grafana/api/public/dashboards/$GRAFANA_PUBLIC_DASHBOARD_TOKEN" >/dev/null
echo 'QA Shop monitoring is ready'

if wait -n "${process_ids[@]}"; then
  echo 'A monitoring process exited unexpectedly' >&2
  exit 1
else
  exit "$?"
fi
