<template>
  <section class="file-browser" aria-label="Dossiers de votre ordinateur">
    <div v-if="nodes.length" class="field">
      <label for="browse-node">Ordinateur</label>
      <select id="browse-node" v-model="nodeId" :disabled="opening">
        <option v-for="node in nodes" :key="node.nodeId" :value="node.nodeId">{{ node.nodeName }}</option>
      </select>
    </div>
    <div v-else class="empty-state compact">
      <NexusIcon name="computer" /><h2>Votre poste est hors ligne</h2>
      <p>Connectez Nexus Desktop pour parcourir les dossiers de cet ordinateur.</p>
      <button type="button" class="button secondary" @click="$emit('settings')">Configurer la connexion</button>
    </div>
    <template v-if="nodes.length">
      <p class="browser-description">Parcourez votre ordinateur, puis choisissez le dossier dans lequel travailler.</p>
      <form class="path-form" @submit.prevent="browse(pathInput)">
        <label for="folder-path" class="sr-only">Chemin du dossier sur le PC</label>
        <input id="folder-path" v-model="pathInput" placeholder="Chemin absolu du dossier" autocomplete="off" autocapitalize="none" spellcheck="false" :disabled="opening" />
        <button type="submit" class="button secondary" :disabled="loading || opening || !pathInput.trim()">Aller</button>
      </form>
      <div class="browser-toolbar">
        <button type="button" class="button secondary" :disabled="!listing?.parent || loading || opening" @click="browse(listing!.parent!)"><NexusIcon name="arrow" />Parent</button>
        <button type="button" class="button secondary" :disabled="loading || opening" @click="browse()">Accueil</button>
        <button type="button" class="icon-button" aria-label="Actualiser les dossiers" :disabled="loading || opening" @click="browse(listing?.path)"><NexusIcon name="refresh" :class="{ 'is-refreshing': loading }" /></button>
      </div>
      <div v-if="listing" class="browser-roots" aria-label="Disques et racines">
        <button v-for="root in listing.roots" :key="root.path" type="button" class="text-button" :disabled="loading || opening" @click="browse(root.path)"><NexusIcon name="computer" />{{ root.name }}</button>
        <button v-if="currentNode?.activeProject" type="button" class="text-button" :disabled="loading || opening" @click="browse(currentNode.activeProject.path)">Dossier de travail</button>
      </div>
      <div v-if="error" class="inline-error" role="alert"><p>{{ error }}</p><button type="button" class="text-button" @click="$emit('settings')">Connexion & paramètres</button></div>
      <p v-if="loading" class="browser-description" role="status">Lecture des dossiers du PC…</p>
      <template v-if="listing">
        <div class="folder-location"><NexusIcon name="folder" /><span>{{ listing.path }}</span></div>
        <div class="browser-filter">
          <label for="folder-filter" class="sr-only">Filtrer les dossiers affichés</label>
          <input id="folder-filter" v-model="filter" type="search" placeholder="Filtrer les dossiers…" />
          <label><input v-model="showHidden" type="checkbox" />Dossiers masqués</label>
        </div>
        <ul class="folder-list" :aria-busy="loading">
          <li v-for="folder in visibleFolders" :key="folder.path">
            <button type="button" :disabled="loading || opening" :aria-label="`Parcourir ${folder.name}`" @click="browse(folder.path)"><NexusIcon name="folder" /><span>{{ folder.name }}</span><NexusIcon name="chevron" /></button>
          </li>
        </ul>
        <p v-if="!visibleFolders.length && !loading" class="browser-description" role="status">{{ filter ? 'Aucun dossier ne correspond au filtre.' : 'Aucun sous-dossier visible ici.' }}</p>
        <div class="folder-selection">
          <p v-if="currentNode?.state === 'busy' || busy">Une tâche est en cours. Vous pouvez parcourir les dossiers et en choisir un à la fin de la tâche.</p>
          <p v-else-if="isCurrent">Ce dossier est votre dossier de travail.</p>
          <p v-else>Les prochaines demandes à votre agent utiliseront ce dossier.</p>
          <button type="button" class="button primary" :disabled="loading || opening || busy || currentNode?.state === 'busy'" @click="openFolder">{{ opening ? 'Ouverture…' : isCurrent ? 'Revenir à la discussion' : 'Travailler dans ce dossier' }}</button>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { DirectoryListing, NodeProjectSummary } from '../../../src/protocol/types';
import NexusIcon from './NexusIcon.vue';
const props = defineProps<{ coreUrl: string; token: string; busy: boolean; nodes: { nodeId: string; nodeName: string; state: string; activeProject?: { path: string } }[] }>();
const emit = defineEmits<{ settings: []; opened: [nodeId: string, project?: NodeProjectSummary] }>();
const nodeId = ref('');
const listing = ref<DirectoryListing | null>(null);
const pathInput = ref('');
const filter = ref('');
const showHidden = ref(false);
const loading = ref(false);
const opening = ref(false);
const error = ref('');
let controller: AbortController | undefined;
let browseVersion = 0;
const currentNode = computed(() => props.nodes.find(node => node.nodeId === nodeId.value));
const isCurrent = computed(() => listing.value?.path === currentNode.value?.activeProject?.path);
const visibleFolders = computed(() => (listing.value?.directories || []).filter(folder => (showHidden.value || !folder.hidden) && folder.name.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())));
watch(() => props.nodes.map(node => node.nodeId).join('|'), () => {
  if (!props.nodes.some(node => node.nodeId === nodeId.value)) nodeId.value = props.nodes[0]?.nodeId || '';
}, { immediate: true });
watch([nodeId, () => props.coreUrl, () => props.token], () => {
  controller?.abort();
  controller = undefined;
  browseVersion++;
  loading.value = false;
  listing.value = null;
  pathInput.value = '';
  error.value = '';
  if (nodeId.value) void browse(currentNode.value?.activeProject?.path);
}, { immediate: true });
onUnmounted(() => { controller?.abort(); controller = undefined; browseVersion++; });

async function request(action: 'browse' | 'open', path?: string) {
  controller?.abort();
  const active = new AbortController();
  controller = active;
  const timer = setTimeout(() => active.abort(), 12000);
  const query = new URLSearchParams({ nodeId: nodeId.value });
  if (path) query.set('path', path);
  try {
    const response = await fetch(`${props.coreUrl.replace(/\/+$/, '')}/api/filesystem${action === 'open' ? '/open' : `?${query}`}`, {
      method: action === 'open' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${props.token}`, ...(action === 'open' ? { 'Content-Type': 'application/json' } : {}) },
      ...(action === 'open' ? { body: JSON.stringify({ path, nodeId: nodeId.value }) } : {}),
      signal: active.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 404 ? 'Mettez à jour Nexus Core et Nexus Desktop pour explorer les dossiers.' : data.error || 'Impossible de joindre votre poste.');
    return controller === active ? data : null;
  } catch (cause: any) {
    if (controller === active) error.value = active.signal.aborted ? 'Le poste ne répond pas. Réessayez avec Actualiser.' : cause.message;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function browse(path?: string) {
  if (!nodeId.value || opening.value) return;
  const version = ++browseVersion;
  loading.value = true;
  error.value = '';
  const data = await request('browse', path);
  if (version !== browseVersion) return;
  if (data?.path && Array.isArray(data.directories)) {
    listing.value = data;
    pathInput.value = data.path;
    filter.value = '';
  }
  loading.value = false;
}
async function openFolder() {
  if (!listing.value || loading.value || opening.value || props.busy || currentNode.value?.state === 'busy') return;
  if (isCurrent.value) { emit('opened', nodeId.value); return; }
  opening.value = true;
  error.value = '';
  const data = await request('open', listing.value.path);
  opening.value = false;
  if (data?.id && data.path) emit('opened', nodeId.value, data);
}
</script>
