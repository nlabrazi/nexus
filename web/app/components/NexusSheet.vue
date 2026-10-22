<template>
  <dialog
    ref="dialog"
    class="sheet"
    :aria-labelledby="titleId"
    @cancel.prevent="close"
    @click="onBackdropClick"
    @close="emit('update:modelValue', false)"
  >
    <div
      ref="sheetBodyRef"
      class="sheet-body"
      :class="{
        'has-scroll-top': canScrollUp,
        'has-scroll-bottom': canScrollDown,
      }"
      @scroll.passive="updateScrollState"
    >
      <header class="sheet-header">
        <h2 :id="titleId">{{ title }}</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="Fermer"
          @click="close"
        >
          <NexusIcon name="close" />
        </button>
      </header>
      <slot />
    </div>
    <div
      class="scroll-affordance-hint"
      :class="{ visible: canScrollDown }"
    >
      <button
        type="button"
        class="scroll-affordance-pill"
        :tabindex="canScrollDown ? 0 : -1"
        aria-label="Défiler vers le bas"
        @click="scrollDown"
      >
        <span>Défiler</span>
        <NexusIcon name="chevron" class="scroll-chevron-down" />
      </button>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId, watch } from "vue";

const props = defineProps<{ modelValue: boolean; title: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const dialog = ref<HTMLDialogElement>();
const sheetBodyRef = ref<HTMLElement>();
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const titleId = useId();

let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;

function updateScrollState() {
  const el = sheetBodyRef.value;
  if (!el) {
    canScrollUp.value = false;
    canScrollDown.value = false;
    return;
  }
  canScrollUp.value = el.scrollTop > 8;
  canScrollDown.value = el.scrollHeight - el.scrollTop - el.clientHeight > 10;
}

function scrollDown() {
  const el = sheetBodyRef.value;
  if (!el) return;
  const step = Math.max(220, Math.round(el.clientHeight * 0.65));
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  const targetTop = remaining <= step * 1.25 ? el.scrollHeight : el.scrollTop + step;
  if (typeof el.scrollTo === "function") {
    el.scrollTo({ top: targetTop, behavior: "smooth" });
  } else {
    el.scrollTop = targetTop;
  }
  setTimeout(updateScrollState, 260);
}

function close() {
  emit("update:modelValue", false);
}

function syncDialog() {
  if (props.modelValue && !dialog.value?.open) {
    dialog.value?.showModal();
    void nextTick(() => {
      updateScrollState();
      setTimeout(updateScrollState, 80);
    });
  } else if (!props.modelValue && dialog.value?.open) {
    dialog.value.close();
  }
}

function onBackdropClick(event: MouseEvent) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    close();
}

watch(() => props.modelValue, syncDialog, { flush: "post" });

onMounted(() => {
  syncDialog();
  if (typeof window !== "undefined" && sheetBodyRef.value) {
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(() => updateScrollState());
      resizeObserver.observe(sheetBodyRef.value);
    }
    if ("MutationObserver" in window) {
      mutationObserver = new MutationObserver(() => {
        void nextTick(updateScrollState);
      });
      mutationObserver.observe(sheetBodyRef.value, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
});
</script>
