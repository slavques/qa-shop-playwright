FROM prom/prometheus:v3.16.0@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06 AS prometheus
FROM grafana/grafana:13.3.1@sha256:0615ec4fbd4072004b7d86b46ded63013a74b7d6eb1119273dd89e8fa25c13cf

USER root
RUN apk upgrade --no-cache libcrypto3 libssl3 zlib \
    && apk add --no-cache bash curl jq tini

COPY --from=prometheus /bin/prometheus /usr/local/bin/prometheus
COPY --from=prometheus /bin/promtool /usr/local/bin/promtool
COPY prometheus/prometheus.yml prometheus/alerts.yml /etc/qa-shop/prometheus/
COPY grafana/provisioning/ /etc/grafana/provisioning/
COPY grafana/dashboards/ /opt/qa-shop/dashboards/
COPY --chmod=0755 hosted/start.sh /usr/local/bin/start-qa-monitoring

ENV GF_USERS_ALLOW_SIGN_UP=false \
    GF_ANALYTICS_REPORTING_ENABLED=false \
    GF_PLUGINS_PREINSTALL_DISABLED=true \
    GRAFANA_DASHBOARDS_PATH=/opt/qa-shop/dashboards \
    PROMETHEUS_URL=http://127.0.0.1:9090

USER 472
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/start-qa-monitoring"]
