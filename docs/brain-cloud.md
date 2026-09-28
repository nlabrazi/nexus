# Fournisseurs cloud de Nexus Brain

Brain utilise maintenant une chaîne de fournisseurs : **Cerebras → Groq → Gemini
→ OpenRouter gratuit → Ollama**. Sans clé configurée, seul Ollama est appelé.
Ces fournisseurs servent aux discussions Brain et aux décisions d’outils existants.
Codex et Antigravity conservent leurs parcours d’implémentation et leurs autorisations.

## Configurer les clés après installation

Les valeurs à remplir sont dans [`.env.example`](../.env.example). Ne pas remplacer
un `.env` existant : ajouter les variables souhaitées en conservant sa configuration.

| Variable de clé | Modèle par défaut | Variable de modèle |
| --- | --- | --- |
| `CEREBRAS_API_KEY` | `gpt-oss-120b` | `CEREBRAS_MODEL` |
| `GROQ_API_KEY` | `openai/gpt-oss-120b` | `GROQ_MODEL` |
| `GEMINI_API_KEY` | `gemini-3.8-flash` | `GEMINI_MODEL` |
| `OPENROUTER_API_KEY` | `openrouter/free` | `OPENROUTER_MODEL` |

`GOOGLE_GENAI_API_KEY` reste accepté si `GEMINI_API_KEY` est absente.
Une clé vide désactive le fournisseur en mode automatique. Aucune clé n’est fournie
ou nécessaire pour compiler et exécuter les tests.

- **Desktop** : ajouter les variables dans le `.env` du répertoire depuis lequel
  `nexus-desktop` est lancé. Le CLI charge ce fichier au démarrage. Redémarrer le
  processus après modification.
- **Extension VS Code** : fournir ces variables dans l’environnement du processus
  qui héberge l’extension. Dans WSL/SSH, il s’agit de l’hôte distant. Le `.env` d’un
  projet n’est pas automatiquement chargé par l’extension. Redémarrer l’hôte avec
  les variables configurées ; recharger une fenêtre ne modifie pas l’environnement
  d’un processus VS Code déjà lancé.
- **Core / Android / navigateur** : aucune clé de fournisseur à saisir dans le client.
  Core relaie les tâches au poste. Configurer seulement le conteneur Core ne suffit
  donc pas à activer le cloud sur un Desktop lancé séparément.

Les clés sont lues au démarrage et restent sur le poste. Le menu de modèles ne
retourne que des identifiants et libellés. Les échanges Brain, leur contexte et les
observations d’outils sont transmis au fournisseur sélectionné. Pour un usage
entièrement local, choisir Ollama ou définir `NEXUS_BRAIN_BACKEND=ollama`.

## Choix et repli

`NEXUS_BRAIN_BACKEND=auto` est la valeur par défaut. Le menu Brain propose :

- **Automatique** : l’ordre des fournisseurs ayant une clé, puis Ollama ;
- les modèles cloud configurés : choix fixe, sans changement de fournisseur ;
- les modèles Ollama découverts, plus le modèle local configuré : choix local fixe.

Le choix du menu vaut pour le processus en cours. Pour fixer le choix au démarrage,
utiliser `auto`, `ollama`, `cerebras`, `groq`, `gemini` ou `openrouter` dans
`NEXUS_BRAIN_BACKEND`. Le mode historique `codex` reste pris en charge.
`NEXUS_BRAIN_MODEL` et `OLLAMA_HOST` (ou `OLLAMA_BASE_URL`) configurent Ollama.
Un fournisseur explicitement choisi sans clé produit une erreur de configuration.

En automatique, un HTTP 429, 402, 408 ou 5xx, une panne réseau, un délai dépassé
ou une réponse structurée invalide déclenchent le fournisseur suivant. Une erreur
d’authentification (401/403), de configuration (autre erreur HTTP) ou un refus de
contenu arrête la demande avec une erreur. Chaque fournisseur cloud reçoit au plus
une tentative de 15 secondes ; le passage complet est borné à 90 secondes, Ollama
étant lui-même limité à 60 secondes. Ces limites s’appliquent à une décision Brain,
qui peut être suivie d’une autre décision après un outil. Annuler empêche tout repli
supplémentaire. Changer de modèle ne redirige pas une décision déjà commencée.

OpenRouter n’accepte que `openrouter/free` ou un identifiant terminé par `:free`.
Pour les autres fournisseurs, les quotas et la facturation dépendent du compte
associé à la clé : Nexus n’active pas de compte payant et ne gère pas son budget.
Les noms de modèles restent configurables car les catalogues évoluent.

## Diagnostic et validation

Les logs `Brain/route` indiquent le fournisseur, le modèle, le statut et la durée ;
`Brain/fallback` indique le suivant. Aucun prompt, réponse ou corps d’erreur cloud
n’y est enregistré. Les clés sont transmises dans les en-têtes HTTP et masquées
par le logger. Les décisions JSON sont validées avant transmission aux outils ;
un modèle ne peut pas ajouter un nouvel outil ou contourner le consentement.

Tests : `npm run test:unit` couvre les quatre formats API, les erreurs, délais,
annulations, l’ordre du repli, le mode local, la sélection et le passage par
`NexusRuntime`. Les réponses HTTP sont simulées : l’accès réel et les quotas
restent à vérifier une fois les clés saisies. Choisir chaque fournisseur dans le
menu Brain et envoyer un message court permet de vérifier la configuration.

Contrats et catalogues consultés le 28 septembre 2026 :
[Cerebras](https://inference-docs.cerebras.ai/api-reference/chat-completions),
[modèles Cerebras](https://inference-docs.cerebras.ai/models/overview),
[Groq JSON](https://console.groq.com/docs/structured-outputs),
[modèles Groq](https://console.groq.com/docs/models),
[Gemini](https://ai.google.dev/gemini-api/docs/models),
[OpenRouter gratuit](https://openrouter.ai/openrouter/free).
