# Client Web Mobile & PWA Nexus

Le client Web de Nexus est une Progressive Web App (PWA) construite avec **Nuxt 3 / Vue 3**, conçue pour être consultée depuis un smartphone ou une tablette. Elle permet de suivre la présence de son poste de travail local (Desktop Node), d'inspecter le projet actif et sa branche Git, et d'accéder aux métriques du serveur central.

---

## 1. Fonctionnalités (Commit 12)

- **Indicateur de connexion Core en temps réel** :
  - Détection automatique de l'hôte ou configuration personnalisée de l'URL Core.
  - Indicateur d'état (Connecté / Connexion / Déconnecté) avec mise à jour automatique toutes les 3 secondes.
  - Calcul et affichage de l'uptime du serveur Core.
- **Présence du Desktop Node** :
  - Nom du poste de travail (ex: `KAOX`).
  - État opérationnel du nœud (`idle` / `busy` / `offline`).
  - Projet actif associé au nœud, chemin local et branche Git courante (`staging`, etc.).
  - Date relative du dernier heartbeat (`il y a 2s`).
  - Instructions et commande de copie rapide si aucun nœud n'est connecté.
- **Projets détectés** :
  - Liste de tous les projets connus via les nœuds en ligne.
  - Badge mettant en valeur le projet actuellement actif.
- **Télémétrie d'activité Core** :
  - Compteurs de nœuds en ligne, tâches en cours et demandes d'approbation en attente.
- **Support PWA complet** :
  - Manifeste Web standard (`/manifest.webmanifest`) avec nom `Nexus Mobile`, icônes 512x512 et orientation portrait.
  - Service Worker automatique (`/sw.js`) pour la mise en cache des assets et l'installabilité sur l'écran d'accueil du téléphone.
  - Thème sombre épuré avec prise en compte des safe areas mobiles (notches, barres de navigation).

---

## 2. Interface de conversation Brain (Commit 13)

L'onglet **💬 Brain Chat** permet de converser directement avec l'IA Nexus Brain depuis n'importe quel smartphone ou tablette :

- **Navigation par onglets** : bascule fluide entre la vue de monitoring (`📊 Nœud & Projets`) et la messagerie instantanée (`💬 Brain Chat`).
- **Exécution distribuée asynchrone / synchrone** :
  - La requête est transmise à Nexus Core via l'API REST `POST /api/tasks` avec `{ backend: 'brain', wait: true }`.
  - Core route la tâche en WebSocket vers le Desktop Node connecté sur le poste de travail.
  - Le Brain résout la réponse (analyse du projet, outils de diagnostic, résumé de fichiers) et la renvoie au client.
- **Rendu conversationnel riche** :
  - Bulles de message distinctes (Utilisateur / Nexus Brain) avec avatars et horodatage.
  - Indicateur de frappe animé pendant l'exécution de la requête.
  - Coloration et blocs de code avec bouton de copie rapide.
- **Chips de requêtes rapides** :
  - Actions en 1 clic pour les besoins récurrents : *"Statut du projet"*, *"Derniers commits"*, *"Fichiers modifiés"*, *"Aide"*.
- **Persistance locale** :
  - L'historique des échanges est conservé dans le `localStorage` du terminal mobile (`nexus_brain_messages`).
  - Bouton d'effacement de l'historique disponible dans l'en-tête du chat.
- **Gestion de la disponibilité du nœud** :
  - Avertissement visuel immédiat si aucun Desktop Node n'est en ligne pour traiter les requêtes.

---

## 3. Déploiement et Accès

### Mode Production (Docker & VPS)
Dans l'image Docker officielle, le client PWA est pré-généré et servi directement par le serveur HTTP intégré de Nexus Core sur le port 4040.

```sh
# Démarrer Nexus Core avec le client PWA intégré
docker compose up -d

# Ouvrir sur smartphone connecté au même réseau Wi-Fi ou via l'IP publique du VPS :
http://<ip-du-serveur>:4040/
```

### Mode Développement Local
Pour développer ou tester le client avec rechargement à chaud (Hot Module Replacement) :

```sh
# 1. Lancer le serveur Nexus Core
npm run core

# 2. Dans un autre terminal, lancer le serveur de dev Nuxt
npm run web:dev
# Accessible sur http://localhost:3000
```

---

## 4. Configuration de la connexion

Lorsque vous ouvrez l'application :
1. Elle tente de se connecter à la même origine que la page (par défaut `http://<ip>:4040` en mode Docker).
2. L'icône d'engrenage (⚙️) en haut à droite permet de spécifier manuellement une URL Nexus Core différente ainsi qu'un jeton d'authentification (`NEXUS_CORE_AUTH_TOKENS`). Ces préférences sont persistées dans le `localStorage` du navigateur.
