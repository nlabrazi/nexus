# Dashboard des agents et quotas

Les paramètres de l’application proposent deux onglets : **Aperçu & quotas**
et **Voix & connexion**. Le premier indique l’agent choisi pour la discussion,
le mode de sélection Brain, le fournisseur/modèle en cours et le dernier modèle
ayant répondu. En automatique, le dernier fournisseur peut différer du premier
configuré après un repli. OpenRouter peut également retourner un modèle effectif
différent de son identifiant de routage.

## Ce que mesurent les indicateurs

| Indicateur | Source et périmètre |
| --- | --- |
| Appels Brain | Tentatives observées par le processus Nexus, y compris les erreurs. Une demande utilisateur peut provoquer plusieurs appels. |
| Tokens Brain | Champ `usage` ou `usageMetadata` des réponses cloud. Les tokens de raisonnement peuvent être inclus dans le total Gemini. Une absence de mesure affiche `—`. |
| Groq | En-têtes API : requêtes par jour, tokens par minute, restant et délai de renouvellement. |
| Cerebras | En-têtes de quota lorsqu’ils sont fournis, séparés par minute/heure/jour. Aucun plafond commercial n’est codé en dur. |
| OpenRouter | `GET /api/v1/key` : plafond de crédits de la clé et compteur quotidien des requêtes gratuites, lorsqu’ils sont communiqués. Le plafond de la clé n’est pas le solde global du compte. |
| Codex | Fenêtres de quota remontées par l’agent : pourcentage restant et date de renouvellement ; consommation de tokens de la session si disponible. |
| Gemini / Antigravity | Consommation quand disponible ; quota restant indiqué « non communiqué » en l’absence d’une donnée exploitable. |
| Ollama | Appels locaux observés, sans quota cloud. Les tokens locaux ne sont pas encore mesurés dans ce dashboard. |

Une fenêtre de cinq heures ne signifie pas cinq heures de travail restantes :
elle définit la période du quota. Nexus ne convertit pas des pourcentages en
heures ou en tokens imaginés. Les valeurs à zéro sont conservées. Les compteurs
Nexus repartent à zéro au redémarrage du poste et ne constituent pas une facture.
Les relevés fournisseurs peuvent inclure d’autres usages du même compte.

Chaque quota porte l’heure du relevé. Après son échéance, ou après cinq minutes
sans nouvelle mesure, son restant est remplacé par **À actualiser**. Nexus ne
suppose pas que le quota est redevenu plein. Les liens de compte permettent de
consulter les informations que l’API ne fournit pas.

## Actualisation et accès

Le client consulte `GET /api/dashboard` à l’ouverture des paramètres, après une
réponse, puis environ toutes les six secondes pendant une demande ou tant que
les paramètres sont ouverts. Les requêtes du client ne se chevauchent pas.
OpenRouter est interrogé au maximum une fois par minute avec regroupement des
appels concurrents, sans envoyer de conversation à son endpoint de quotas.
Groq et Cerebras fournissent leurs relevés lors des appels Brain existants :
actualiser l’écran ne génère pas une requête d’inférence supplémentaire.

L’endpoint exige le jeton Nexus si Core configure des jetons, et utilise
`Cache-Control: no-store`. Les quotas ne sont pas ajoutés au `/status` public.
Core demande le dashboard au Desktop par `node:dashboard:get` et accepte la
réponse uniquement du nœud ciblé. Le délai est borné ; une ancienne version du
poste affiche un message de mise à jour/connexion au lieu d’un tableau vide.

Mettre à jour **Core et le poste Desktop**, redémarrer leurs processus, puis
installer la nouvelle APK. Aucune clé fournisseur n’est saisie sur Android.
Les erreurs des fournisseurs ne transmettent ni corps de réponse, ni clé,
ni conversation au dashboard. Les réglages de connexion gardent le même jeton.

## Fluidité

Les messages apparaissent avec une transition courte, sans effet de frappe qui
retarderait leur lecture. Le temps d’attente affiché est réel. Les animations
de présence, d’activité, des panneaux et des boutons respectent
`prefers-reduced-motion`. Elles ne raccourcissent pas le temps de génération du
modèle ; les durées du dashboard permettent de distinguer ce temps de celui de
l’interface.

Validation : 559 tests backend, 23 tests web et 2 tests VS Code, compilation/lint, génération Nuxt,
compilation Android et parcours mobile simulé. Le parcours Chrome vérifie les
modèles, un quota épuisé, l’absence de débordement horizontal, les onglets au
clavier, les animations réduites et les réponses vocales. Les relevés de quota
sont simulés dans les tests ; leur disponibilité réelle dépend des comptes.

Références consultées le 29 septembre 2026 :
[Groq](https://console.groq.com/docs/rate-limits),
[Cerebras](https://inference-docs.cerebras.ai/support/rate-limits),
[OpenRouter](https://openrouter.ai/docs/api_reference/limits),
[Gemini](https://ai.google.dev/gemini-api/docs/rate-limits).
