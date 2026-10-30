# Changelog

Toutes les évolutions notables de NeonInk sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Unreleased]

## [0.6.0] - 2026-10-30

### Ajouté
- Outil texte (**I**) : le curseur apparaît sous la souris et l'on écrit directement au clavier, en néon (accents compris). Entrée pour une nouvelle ligne, Échap ou un clic pour terminer, molette pour la taille. Le texte s'efface à la gomme.
- Traits en tirets (**L**), formes reconnues comprises.

### Modifié
- Exécutable allégé de 16 % (2,9 Mo) et installateur de 10 % (1,2 Mo) : fonctions inutilisées de Tauri retirées, optimisation de taille maximale.
- Builds de contrôle sur GitHub plus rapides : optimisation plus légère, fichiers envoyés sans recompression, cache sauvegardé depuis `main` uniquement.

## [0.5.0] - 2026-10-30

### Ajouté
- Les raccourcis se changent directement dans l'aide : clic sur une touche puis appui sur la nouvelle, **+** pour en ajouter une, clic droit pour la retirer, bouton « Touches d'origine ». Le raccourci global (F10) aussi.
- Menu de l'icône › « Raccourcis clavier… » ouvre cette aide.

### Modifié
- `config.json` garde l'ordre de ses réglages quand NeonInk l'enregistre.

## [0.4.0] - 2026-10-30

### Ajouté
- Tableau noir (**Maj+K**) et tableau blanc (**Maj+W**) : un fond opaque pour dessiner sur une page vierge ; la même touche revient à l'écran.
- Mises à jour automatiques : recherche au démarrage puis toutes les 2 heures, installation dès que NeonInk est inactif. Désactivable dans le menu de l'icône.
- Lancement avec Windows, activé au premier démarrage et réglable dans le menu de l'icône.
- Une seule instance : relancer NeonInk active le dessin au lieu d'ouvrir une deuxième copie.
- Raccourcis personnalisables, F10 compris, dans `config.json` (menu de l'icône › Personnaliser les raccourcis…), rechargés dès l'enregistrement. L'aide affiche les touches en vigueur.
- Panneau d'aide animé : bordure néon tournante, titre qui s'allume comme une enseigne, lignes en cascade.
- Un petit secret se cache en mode dessin. Indice : trois lettres.
- Tests Windows automatisés : affichage du calque, installation, migration, mise à jour et désinstallation.

### Modifié
- Installation dans Program Files pour tous les utilisateurs, comme un logiciel classique (droits administrateur demandés). L'ancienne copie installée dans AppData est désinstallée automatiquement.
- Installateur en français, avec l'éditeur, la description et le site du projet ; l'exécutable s'appelle désormais `NeonInk.exe`.

### Corrigé
- L'écran pouvait rester figé pendant le dessin avec la fréquence variable ou le HDR : le calque produit désormais une image à chaque rafraîchissement, et il est déclaré comme fenêtre flottante (Chrome, Edge et les applications Electron ne le prennent plus pour une fenêtre qui les masque).
- L'installation échouait (« Error opening file for writing ») quand NeonInk tournait encore ou que le dossier choisi exigeait les droits administrateur.

## [0.3.1] - 2026-10-29

### Corrigé
- Tentative de correction de l'image figée derrière le calque (calque d'un pixel plus petit que l'écran) ; insuffisante, voir la version suivante.

## [0.3.0] - 2026-10-29

### Ajouté
- Mise à jour depuis l'application : le menu de l'icône propose d'installer la nouvelle version dès sa publication.
- Version portable : chaque release contient aussi l'exécutable seul, sans installation.
- En mode étapes, glisser dessine un trait ou une forme ; un simple clic pose toujours la pastille suivante.

### Modifié
- F10 masque les tracés en quittant le dessin et les réaffiche au F10 suivant, sur le même écran.

## [0.2.0] - 2026-10-29

### Ajouté

- Gomme précise (touche **T**) : elle retire seulement la portion du trait sous le curseur, le reste est conservé.
- Reconnaissance des courbes : un arc ou une vague devient une courbe de Bézier lisse au lieu d'un tracé tremblé.
- Les flèches entre étapes sont désormais courbes.

### Modifié

- **Échap** efface tous les tracés et quitte le mode dessin. **F10** bascule le mode dessin en conservant les tracés.
- Un trait légèrement courbé n'est plus redressé de force : la détection des traits droits est plus stricte.

### Corrigé

- Les étapes sont renumérotées quand l'une d'elles est effacée ou annulée : 1, 2, 4, 5 redevient 1, 2, 3, 4 et la prochaine étape porte le bon numéro.
- En quittant le mode dessin, le clavier est rendu à l'application précédente ; la saisie ne paraît plus bloquée.

## [0.1.0] - 2026-10-29

### Ajouté

- Calque de dessin transparent par-dessus l'écran, activé par **F10**, avec icône dans la zone de notification.
- Trait néon animé : naissance « chauffée à blanc », comète lumineuse, désintégration en étincelles.
- Dix couleurs au clavier (R, G, B, Y, O, P, V, C, W, K) et épaisseur réglable à la molette.
- Reconnaissance de formes : trait droit, cercle, ellipse, carré, rectangle, triangle.
- Gomme (touche **E** ou clic droit) et annulation (**Ctrl+Z**).
- Étapes numérotées reliées par des flèches (touche **S**, nouvelle séquence avec **N**).
- Aide à l'écran (touche **H**) et prise en charge de plusieurs écrans.

[Unreleased]: https://github.com/pmaldi/neon-ink/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/pmaldi/neon-ink/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/pmaldi/neon-ink/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/pmaldi/neon-ink/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/pmaldi/neon-ink/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/pmaldi/neon-ink/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pmaldi/neon-ink/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pmaldi/neon-ink/releases/tag/v0.1.0
