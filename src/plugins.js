// Plugins : des fonctionnalités en plus, téléchargées à la demande (menu Aide › Plugins).
//
// Un plugin est un module JavaScript autonome qui exporte `manifest` et `activate(api)`.
// Il ajoute des outils, des types d'objets dessinés et des raccourcis ; NeonInk se charge du
// clavier, de la gomme, de l'annulation, de la capture et du rendu. Voir plugins/README.md.

export const API_VERSION = 1;

/**
 * Registre des plugins chargés. `host` fournit ce dont les plugins ont besoin dans main.js
 * (état, ajout d'objets, rendu, notifications…).
 */
export function createPluginHost(host) {
  const loaded = new Map(); // id → { manifest, tools, types, actions }
  const types = new Map(); // « plugin.type » → définition
  const tools = new Map(); // « plugin:id » → outil
  const actions = new Map(); // nom d'action → { label, key, run, plugin }

  function apiFor(manifest) {
    const id = manifest.id;
    const own = loaded.get(id);
    const name = (n) => `${id}.${n}`;
    return {
      version: API_VERSION,
      id,
      palette: host.palette,
      draw: host.draw,
      get color() { return host.state.color; },
      get width() { return host.state.width; },
      get dashed() { return host.state.dashed; },
      get board() { return host.state.board; },

      /**
       * Type d'objet : { draw(ctx, o, f), hit(o, p, r), center(o), animated, layer }.
       * `f` = { now, age, intro (0→1 à l'apparition), life (1→0 quand il s'efface) }.
       * `animated` (booléen ou fonction de l'objet) : redessiné à chaque image.
       */
      defineObject(type, def) {
        types.set(name(type), { layer: 0, ...def, plugin: id });
        own.types.push(name(type));
      },
      /**
       * Outil : { label(), down(p, e), move(p, e), up(p, e), cancel(), preview(ctx, now),
       * cursor(ctx, p, now), busy() }. Rend le nom complet de l'outil, pour `useTool`.
       */
      defineTool(tool, def) {
        const key = `plugin:${name(tool)}`;
        tools.set(key, { ...def, plugin: id });
        own.tools.push(key);
        return key;
      },
      /** Raccourci : { label, key (touche par défaut), run() }. Il apparaît dans l'aide. */
      defineAction(action, def) {
        actions.set(name(action), { ...def, plugin: id });
        own.actions.push(name(action));
      },

      useTool: (tool) => host.setTool(`plugin:${name(tool)}`),
      toolActive: (tool) => host.state.tool === `plugin:${name(tool)}`,
      /** Ajoute un objet `type` ({ x, y, …données libres }). `deps` : objets dont il dépend. */
      add(type, data) {
        return host.add({ ...data, kind: 'plugin', type: name(type), plugin: id });
      },
      remove: (o) => host.remove(o),
      /** Objets de ce plugin encore affichés, éventuellement d'un seul type. */
      objects: (type) => host.objects().filter((o) => o.plugin === id && (!type || o.type === name(type))),
      /** Objet de ce plugin sous le point `p` (le plus récent d'abord). */
      objectAt(p, r = 0, type) {
        const list = this.objects(type);
        for (let i = list.length - 1; i >= 0; i--) if (hit(list[i], p, r)) return list[i];
        return null;
      },
      snap: (p) => host.snap(p),
      toast: (msg, ms) => host.toast(msg, ms),
      render: () => host.render(),
      refreshHud: () => host.refreshHud(),
    };
  }

  function hit(o, p, r) {
    const t = types.get(o.type);
    return !!t?.hit?.(o, p, r);
  }

  return {
    types,
    tools,
    actions,
    loaded,
    hit,
    draw(ctx, o, frame) {
      types.get(o.type)?.draw(ctx, o, frame);
    },
    layer: (o) => types.get(o.type)?.layer ?? 0,
    animated(o) {
      const a = types.get(o.type)?.animated;
      return typeof a === 'function' ? !!a(o) : !!a;
    },
    center: (o) => types.get(o.type)?.center?.(o) ?? (Number.isFinite(o.x) ? { x: o.x, y: o.y } : null),

    /**
     * Charge le code d'un plugin et l'active. `entry` (fiche du catalogue) complète le
     * `manifest` exporté par le module. Rend le manifeste.
     */
    async load(code, entry = {}) {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      let manifest;
      try {
        const mod = await import(url);
        manifest = { ...mod.manifest, ...entry };
        if (!manifest.id || typeof mod.activate !== 'function') throw new Error('ce fichier n’est pas un plugin NeonInk');
        if (manifest.api !== API_VERSION) throw new Error(`${manifest.nom ?? manifest.id} demande une autre version de NeonInk`);
        if (loaded.has(manifest.id)) return loaded.get(manifest.id).manifest;
        loaded.set(manifest.id, { manifest, tools: [], types: [], actions: [] });
        mod.activate(apiFor(manifest));
        return manifest;
      } catch (err) {
        if (manifest?.id && loaded.has(manifest.id)) this.unload(manifest.id);
        throw err;
      } finally {
        URL.revokeObjectURL(url);
      }
    },

    /** Retire tout ce qu'un plugin a ajouté. Ses objets doivent être effacés par l'appelant. */
    unload(id) {
      const own = loaded.get(id);
      if (!own) return;
      own.tools.forEach((k) => tools.delete(k));
      own.types.forEach((k) => types.delete(k));
      own.actions.forEach((k) => actions.delete(k));
      loaded.delete(id);
    },

    /** Sections de l'aide : une par plugin chargé. */
    helpSections() {
      return [...loaded.values()]
        .filter((p) => p.actions.length)
        .map((p) => [`Plugin ${p.manifest.nom ?? p.manifest.id}`, p.actions.map((a) => [a, actions.get(a).label])]);
    },
  };
}
