<template>
  <dialog
    ref="dialog"
    class="sheet"
    :aria-labelledby="titleId"
    @cancel.prevent="close"
    @click="onBackdropClick"
    @close="emit('update:modelValue', false)"
  >
    <div class="sheet-body">
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
  </dialog>
</template>

<script setup lang="ts">
import { onMounted, ref, useId, watch } from "vue";

const props = defineProps<{ modelValue: boolean; title: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
function close() {
  emit("update:modelValue", false);
}
function syncDialog() {
  if (props.modelValue && !dialog.value?.open) dialog.value?.showModal();
  else if (!props.modelValue && dialog.value?.open) dialog.value.close();
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
onMounted(syncDialog);
</script>
