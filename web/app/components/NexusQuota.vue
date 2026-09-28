<template>
  <div class="quota-metric" :class="{ stale: view.stale }">
    <div class="quota-heading"><span>{{ metric.label }}</span><strong>{{ view.remaining }}</strong></div>
    <progress v-if="view.percent !== undefined" :value="view.percent" max="100" :aria-label="`${metric.label} : ${view.remaining} restants`" />
    <small>{{ view.stale ? 'Dernier relevé expiré' : 'Restant au dernier relevé' }}<template v-if="metric.limit !== undefined"> · plafond {{ formatCount(metric.limit) }}{{ metric.unit === 'percent' ? '%' : metric.unit === 'USD' ? ' $' : '' }}</template><template v-if="view.reset"> · renouvellement {{ view.reset }}</template></small>
    <small>Relevé à {{ new Date(metric.observedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</small>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { QuotaMetric } from '../../../src/runtime/dashboard-types';
import { formatCount, quotaView } from '../utils/usage-dashboard.mjs';
const props = defineProps<{ metric: QuotaMetric; now: number }>();
const view = computed(() => quotaView(props.metric, props.now));
</script>
