# Changelog

Toutes les évolutions notables de NeonInk sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Corrigé
- L'image ne se fige plus derrière le calque pendant le dessin : Windows prenait le calque pour une application plein écran et cessait de rafraîchir les fenêtres situées dessous.

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

[Unreleased]: https://github.com/pmaldi/neon-ink/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/pmaldi/neon-ink/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pmaldi/neon-ink/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pmaldi/neon-ink/releases/tag/v0.1.0
