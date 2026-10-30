// Plugin « Minuteur » pour NeonInk : un compte à rebours (ou un chronomètre) en néon, en haut à
// droite de l'écran, pour minuter un exercice, une pause ou une prise de parole.
//
// Maj+T (par défaut) : roue des durées (1, 2, 5, 10, 15, 30 min, Chronomètre). Maintenir, viser,
// relâcher ; ou appuyer puis cliquer. Le choix lance le minuteur.
// Maj+T pendant qu'il tourne : pause / reprise. Alt+T : arrêter le minuteur.
// L'anneau se vide avec le temps restant ; les 10 dernières secondes, il bat ; à zéro, il
// clignote 3 secondes, affiche « Temps écoulé », puis disparaît de lui-même.
// Le minuteur reste affiché quand on quitte le dessin ; les touches, elles, ne marchent qu'en
// mode dessin (F10).

export const manifest = {
  id: 'minuteur',
  nom: 'Minuteur',
  description: 'Compte à rebours ou chronomètre en néon dans le coin de l’écran, avec pause et alerte à la fin.',
  version: '1.0.0',
  api: 1,
};

const TAU = Math.PI * 2;
const CHOICES = [1, 2, 5, 10, 15, 30, null]; // minutes ; null : chronomètre
const FLASH = 3000; // clignotement à zéro, en ms
const OVER = 8000; // « Temps écoulé » reste affiché jusqu'à cette durée après zéro, en ms
const R = 34; // rayon de l'anneau

/** MM:SS (ou H:MM:SS au-delà d'une heure). */
function clockText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function activate(api) {
  if (!api.defineOverlay) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let timer = null; // { total (ms, null : chronomètre), start, pausedAt, endedAt }
  let lastChoice = 2;
  const now = () => performance.now();

  /** Temps écoulé depuis le départ, pauses déduites. */
  function elapsed(t) {
    return (timer.pausedAt ?? t) - timer.start;
  }

  function startTimer(i) {
    lastChoice = i;
    const min = CHOICES[i];
    timer = { total: min == null ? null : min * 60000, start: now(), pausedAt: null, endedAt: null };
    api.toast(min == null ? '⏱ Chronomètre lancé' : `⏱ Minuteur : ${min} min`);
    api.render();
  }

  function togglePause() {
    const t = now();
    if (timer.pausedAt == null) {
      timer.pausedAt = t;
      api.toast('⏱ Minuteur en pause');
    } else {
      timer.start += t - timer.pausedAt;
      timer.pausedAt = null;
      api.toast('⏱ Minuteur reparti');
    }
    api.render();
  }

  function stop() {
    if (!timer) return api.toast('Aucun minuteur en cours');
    timer = null;
    api.toast('⏱ Minuteur arrêté');
    api.render();
  }

  function durationWheel() {
    api.wheel({
      items: CHOICES.map((min) => ({
        label: min == null ? 'Chronomètre' : `${min} min`,
        draw(ctx, x, y, s, color, alpha) {
          const ring = new Path2D();
          ring.arc(x, y, s, 0, TAU);
          api.draw.neon(ctx, ring, color, 2, alpha * 0.8);
          if (min == null) {
            const hand = new Path2D();
            hand.moveTo(x, y);
            hand.lineTo(x + s * 0.45, y - s * 0.55);
            hand.moveTo(x - s * 0.25, y - s * 1.3);
            hand.lineTo(x + s * 0.25, y - s * 1.3);
            api.draw.neon(ctx, hand, color, 2, alpha);
          } else api.draw.label(ctx, String(min), x, y, color, { size: 15, alpha });
        },
      })),
      selected: lastChoice,
      onPick: startTimer,
    });
  }

  // ───────── Affichage ─────────

  function arc(ctx, cx, cy, r, from, to, color, width, alpha, boost) {
    const p = new Path2D();
    p.arc(cx, cy, r, from, to);
    api.draw.neon(ctx, p, color, width, alpha, boost);
  }

  api.defineOverlay('minuteur', {
    active() {
      if (!timer) return false;
      // Fin : l'anneau disparaît de lui-même quelques secondes après « Temps écoulé ».
      if (timer.endedAt != null && now() - timer.endedAt > OVER) {
        timer = null;
        return false;
      }
      return true;
    },
    draw(ctx, t) {
      const { w } = api.size;
      const cx = w - 30 - R, cy = 64 + R; // sous la barre d'état, coin droit
      const base = api.color === api.palette.k ? api.palette.w : api.color;
      const paused = timer.pausedAt != null;
      const spent = elapsed(t);
      const top = -Math.PI / 2;

      // Fond sombre discret pour rester lisible sur n'importe quel écran.
      ctx.fillStyle = 'rgba(6,8,14,0.72)';
      ctx.beginPath();
      ctx.arc(cx, cy, R + 12, 0, TAU);
      ctx.fill();

      if (timer.total == null) {
        // Chronomètre : anneau complet et un arc qui fait le tour en une minute.
        arc(ctx, cx, cy, R, 0, TAU, base, 1.5, 0.25);
        const k = (spent % 60000) / 60000;
        arc(ctx, cx, cy, R, top, top + k * TAU, base, 3, 0.95, 0.1);
        api.draw.glowDot(ctx, cx + Math.cos(top + k * TAU) * R, cy + Math.sin(top + k * TAU) * R, 7, base, 0.9);
        const blink = paused && Math.floor(t / 500) % 2;
        api.draw.label(ctx, clockText(spent), cx, cy, base, { size: 15, alpha: blink ? 0.35 : 1 });
        if (paused) api.draw.label(ctx, 'PAUSE', cx, cy + R + 22, base, { size: 11, alpha: 0.8 });
        return;
      }

      const left = timer.total - spent;
      if (left <= 0 && timer.endedAt == null) {
        timer.endedAt = timer.start + timer.total;
        api.toast('⏱ Temps écoulé !', 3000);
      }

      if (timer.endedAt != null) {
        const since = t - timer.endedAt;
        const red = api.palette.r;
        if (since < FLASH) {
          // Clignotement : anneau plein, rouge, qui s'allume et s'éteint.
          const lit = Math.floor(since / 250) % 2 === 0;
          arc(ctx, cx, cy, R, 0, TAU, red, lit ? 4 : 2, lit ? 1 : 0.3, lit ? 0.5 : 0);
          api.draw.label(ctx, '00:00', cx, cy, red, { size: 15, alpha: lit ? 1 : 0.4 });
        } else {
          const fade = Math.min(1, (OVER - since) / 800);
          arc(ctx, cx, cy, R, 0, TAU, red, 2, 0.6 * fade);
          api.draw.label(ctx, 'Temps', cx, cy - 8, red, { size: 12, alpha: fade });
          api.draw.label(ctx, 'écoulé', cx, cy + 8, red, { size: 12, alpha: fade });
        }
        return;
      }

      const k = left / timer.total;
      const last = left < 10000;
      // Les 10 dernières secondes : couleur d'alerte et battement chaque seconde.
      const color = last ? api.palette.r : base;
      const beat = last ? Math.max(0, 1 - (left % 1000) / 350) : 0;
      arc(ctx, cx, cy, R, 0, TAU, color, 1.5, 0.2);
      arc(ctx, cx, cy, R, top, top + k * TAU, color, 3 + beat * 2, 0.95, 0.1 + beat * 0.6);
      api.draw.glowDot(ctx, cx + Math.cos(top + k * TAU) * R, cy + Math.sin(top + k * TAU) * R, 7 + beat * 6, color, 0.9);
      const blink = paused && Math.floor(t / 500) % 2;
      api.draw.label(ctx, clockText(left + 999), cx, cy, color, { size: 15 + beat * 3, alpha: blink ? 0.35 : 1 });
      if (paused) api.draw.label(ctx, 'PAUSE', cx, cy + R + 22, color, { size: 11, alpha: 0.8 });
    },
  });

  api.defineAction('minuteur', {
    label: 'Minuteur',
    hint: 'Roue des durées ; pendant qu’il tourne : pause / reprise',
    key: 'Shift+T',
    run() {
      if (timer && timer.endedAt == null) togglePause();
      else durationWheel();
    },
  });

  api.defineAction('arreter', {
    label: 'Arrêter le minuteur',
    key: 'Alt+T',
    run: stop,
  });
}
