# Mise en forme des réponses Codex dans Telegram

Les réponses à `/codex` bénéficient d'une présentation sobre, sans configuration
supplémentaire ni dépendance ajoutée. Le contenu de la réponse est conservé :
Nexus adapte sa présentation, sans demander à Codex de le réécrire ou de le résumer.

## Rendu pris en charge

- Titres Markdown `#` à `######` et passages `**gras**` / `__gras__` : gras.
- Listes `-`, `+` ou `*` : puces simples, avec conservation de l'indentation.
  Les listes numérotées et les sauts de ligne sont conservés.
- Code entre backticks : monospace. Blocs délimités par au moins trois backticks
  ou tildes : préformatés, avec le langage lorsqu'il est indiqué.
- Liens Markdown HTTP/HTTPS : cliquables, avec les aperçus désactivés pour
  limiter l'encombrement. Les références locales deviennent un libellé suivi du
  chemin en monospace, puisque Telegram ne peut pas ouvrir un fichier de VS Code.

Le rendu est volontairement limité : pas de transformation des tableaux,
de l'italique ou des syntaxes avancées. Le gras et les liens sont reconnus sur
une même ligne. Les syntaxes non reconnues restent en texte. Le HTML présent
dans une réponse reste littéral. Le code conserve ses espaces et caractères.

Les styles sont transmis avec les entités natives de
[l'API Telegram](https://core.telegram.org/bots/api#messageentity), sans
`parse_mode`. Les positions sont calculées sur le texte affiché, en unités
UTF-16. Un passage de code dans un titre ou du gras garde son style monospace :
Telegram interdit d'imbriquer ces styles avec le code.

## Réponses longues

Chaque message contient au maximum 4 000 unités UTF-16, sous la limite de
[sendMessage](https://core.telegram.org/bots/api#sendmessage). La coupure privilégie
un paragraphe, puis une ligne ou un espace dans la seconde moitié du message.
À défaut, le texte est coupé à la limite, en préservant les caractères composés
et les emoji usuels. Les styles sont recalculés pour chaque morceau, y compris
lorsqu'un bloc de code dépasse la taille d'un message. Aucun texte n'est tronqué.

La commande `/status` utilise également le formatage pour ses titres de section.
Les autres messages ordinaires restent en texte brut ; ils partagent le découpage et
la désactivation des aperçus. Les demandes d'approbation conservent leur envoi
distinct, leurs boutons et l'affichage intégral des détails.

## Vérification

```sh
npm run test:unit
npm run compile
```

Les tests couvrent le rendu, les caractères spéciaux, les références locales,
les styles autour du code, les limites de longueur, les emoji, les envois HTTP
simulés et l'activation du formatage sur la réponse Codex, avec des erreurs littérales.

Pour vérifier le rendu réel : compiler, relancer F5, puis envoyer au bot appairé :

```text
/codex Sans lire ni modifier de fichier, donne un petit exemple Markdown avec un titre, deux puces dont une avec du gras, une commande en code inline, un bloc TypeScript de trois lignes et un lien vers https://www.typescriptlang.org/. Reste concis.
```

Vérifier les styles, les espaces dans le code et l'absence d'aperçu du lien.
Pour tester le découpage, demander ensuite une réponse de plus de 4 000
caractères contenant un long bloc de code. Les morceaux doivent arriver dans
l'ordre et garder leur présentation. Aucun bot réel n'est contacté par les tests.
