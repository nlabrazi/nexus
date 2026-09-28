<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="icon"
  >
    <path :d="paths[name]" />
  </svg>
</template>

<script setup lang="ts">
const paths = {
  nexus: "M5 19V5l14 14V5M5 12h14",
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z M7 9h9M7 13h6",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  folder:
    "M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  arrow: "M12 19V5M5 12l7-7 7 7",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  close: "m6 6 12 12M6 18 18 6",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  stop: "M6 6h12v12H6Z",
  refresh:
    "M20 7V2m0 5h-5M4 17v5m0-5h5M20 7a9 9 0 0 0-16 2M4 17a9 9 0 0 0 16-2",
  check: "m5 12 4 4L19 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  branch:
    "M6 6v12M18 6v3a5 5 0 0 1-5 5H6M8 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM8 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM20 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  computer: "M3 4h18v13H3ZM12 17v4M7 21h10",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  plus: "M12 5v14M5 12h14",
  dots: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  sparkles:
    "m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z",
  cpu: "M4 4h16v16H4zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8Z",
  speaker: "M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14",
  speakerOff: "M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6",
} as const;
defineProps<{ name: keyof typeof paths }>();
</script>
