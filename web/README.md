# Nexus mobile

Client Nuxt de Nexus, intégré à l’application Android avec Capacitor.

## Parcours

- **Discussion** : écrire ou dicter un message, choisir son agent et consulter sa réponse. Les deux suggestions de départ préparent un brouillon modifiable.
- **Activité** : suivre ou arrêter les tâches, déplier leurs résultats et examiner les demandes d’autorisation.
- **Projets** : sélectionner un projet pour revenir directement à la discussion. Les informations du poste se déplient à la demande.
- **Connexion** : toucher l’état de connexion en haut à droite pour renseigner le serveur, le jeton et les préférences de dictée.

Entrée ajoute une ligne dans le message. Ctrl+Entrée ou Cmd+Entrée l’envoie. Hors ligne, le brouillon reste éditable et l’envoi est désactivé.

## Interface

Le thème graphite et cuivre se trouve dans `app/assets/nexus.css`. Les composants `NexusIcon` et `NexusSheet` centralisent les icônes et les panneaux modaux. Les dialogues gèrent le focus et la fermeture avec Échap ; les zones tactiles principales mesurent au moins 48 px. La hauteur de l’application suit le clavier via le viewport visuel et respecte les marges système.

Les états et les branches affichés proviennent du serveur : aucune branche de remplacement ni statistique fictive.

## Développement

Depuis ce dossier :

```sh
npm install
npm run dev
npm run generate
```

La génération statique est écrite dans `.output/public`.

Pour préparer le projet Android :

```sh
npm run cap:sync
npm run cap:open
```

Sur téléphone, renseigner l’adresse réseau du serveur Nexus accessible depuis l’appareil. Les parcours web peuvent être vérifiés au format mobile dans le navigateur ; le micro natif, le bouton Retour et le clavier Android doivent aussi être vérifiés sur appareil ou émulateur.

## Générer un APK à tester sur téléphone

Depuis la racine du dépôt :

```sh
npm run android:build
```

Cette commande compile l’interface, synchronise Capacitor, lance Gradle et dépose `nexus-debug.apk` à la racine. Transférer ce fichier sur le téléphone puis l’ouvrir pour installer Nexus.

La compilation utilise Java 21 et un SDK Android du même système que Gradle, avec la plateforme 35 et les build-tools 34.0.0. Sous Linux/WSL, les outils dédiés à Nexus sont détectés dans `~/.local/share/nexus/android/{jdk-21,sdk}`. Sinon, renseigner `JAVA_HOME` et `ANDROID_HOME`. Le Java système et la configuration SDK d’Android Studio ne sont pas modifiés.

`npm run android:sync` synchronise uniquement les fichiers web et les plugins ; `npm run android:build` produit réellement l’APK. Android Studio n’est pas nécessaire à cette compilation.
