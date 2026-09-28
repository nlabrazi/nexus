const countFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export function formatCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? countFormatter.format(value) : '—';
}
export function quotaView(metric, now = Date.now()) {
  const stale = !Number.isFinite(metric.observedAt) || now - metric.observedAt > 300_000 || (metric.resetsAt !== undefined && now >= metric.resetsAt);
  const known = typeof metric.remaining === 'number' && Number.isFinite(metric.remaining);
  const percent = known && metric.limit > 0 ? Math.min(100, Math.max(0, metric.remaining / metric.limit * 100)) : undefined;
  const unit = metric.unit === 'percent' ? '%' : metric.unit === 'USD' ? '$' : metric.unit === 'requests' ? 'requêtes' : 'tokens';
  const wait = metric.resetsAt && metric.resetsAt > now ? metric.resetsAt - Math.max(now, metric.observedAt) : undefined;
  return {
    stale, percent: stale ? undefined : percent,
    remaining: stale ? 'À actualiser' : known ? `${formatCount(metric.remaining)} ${unit}` : 'Non communiqué',
    reset: wait === undefined ? undefined : wait >= 3_600_000 ? `dans ${Math.ceil(wait / 3_600_000)} h` : wait >= 60_000 ? `dans ${Math.ceil(wait / 60_000)} min` : `dans ${Math.ceil(wait / 1000)} s`,
  };
}
