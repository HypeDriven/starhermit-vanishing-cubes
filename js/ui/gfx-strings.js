// Localised strings for the Graphics settings section. The rest of the game is
// English-only; this panel follows navigator.language, falling back by
// language and then to en-US.

const S = {
  'en-US': {
    quality: 'Quality', auto: 'Auto (detected: {tier})', low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
    renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing',
    reflections: 'Reflections', particles: 'Particles', background: 'Sky animation', detail: 'Surface detail',
    off: 'Off', on: 'On', medium: 'Medium', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    static: 'Static', animated: 'Animated', plain: 'Plain', detailed: 'Detailed',
    adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    postFailed: 'Post-processing is unavailable on this device; effects that need it are skipped.',
    unknownGpu: 'unknown GPU',
    w_noShadows: 'no shadows', w_shadows: '{n}² shadows', w_ao: 'ambient occlusion', w_aoHigh: 'full ambient occlusion',
    w_bloom: 'bloom', w_reflections: 'reflections', w_noAa: 'no anti-aliasing', w_px: '{w}×{h} px',
  },
  'en-GB': {
    grade: 'Colour grade',
  },
  'es-419': {
    quality: 'Calidad', auto: 'Automática (detectada: {tier})', low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing',
    reflections: 'Reflejos', particles: 'Partículas', background: 'Animación del cielo', detail: 'Detalle de superficies',
    off: 'Desactivado', on: 'Activado', medium: 'Media',
    static: 'Estático', animated: 'Animado', plain: 'Simple', detailed: 'Detallado',
    adaptive: 'Resolución adaptable', showFps: 'Mostrar fotogramas por segundo',
    postFailed: 'El posprocesamiento no está disponible en este dispositivo; se omiten los efectos que lo requieren.',
    unknownGpu: 'GPU desconocida',
    w_noShadows: 'sin sombras', w_shadows: 'sombras {n}²', w_ao: 'oclusión ambiental', w_aoHigh: 'oclusión ambiental completa',
    w_bloom: 'resplandor', w_reflections: 'reflejos', w_noAa: 'sin antialiasing',
  },
  'es-ES': {
    quality: 'Calidad', auto: 'Automática (detectada: {tier})', low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Suavizado de bordes',
    reflections: 'Reflejos', particles: 'Partículas', background: 'Animación del cielo', detail: 'Detalle de superficies',
    off: 'Desactivado', on: 'Activado', medium: 'Media',
    static: 'Estático', animated: 'Animado', plain: 'Simple', detailed: 'Detallado',
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    postFailed: 'El posprocesado no está disponible en este dispositivo; se omiten los efectos que lo necesitan.',
    unknownGpu: 'GPU desconocida',
    w_noShadows: 'sin sombras', w_shadows: 'sombras {n}²', w_ao: 'oclusión ambiental', w_aoHigh: 'oclusión ambiental completa',
    w_bloom: 'resplandor', w_reflections: 'reflejos', w_noAa: 'sin suavizado',
  },
  'de-DE': {
    quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})', low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
    renderScale: 'Renderskalierung', fromPreset: 'Aus Voreinstellung ({tier})',
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom', grade: 'Farbkorrektur', antialias: 'Kantenglättung',
    reflections: 'Spiegelungen', particles: 'Partikel', background: 'Himmelsanimation', detail: 'Oberflächendetails',
    off: 'Aus', on: 'An', medium: 'Mittel',
    static: 'Statisch', animated: 'Animiert', plain: 'Schlicht', detailed: 'Detailliert',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte, die sie benötigen, entfallen.',
    unknownGpu: 'unbekannte GPU',
    w_noShadows: 'keine Schatten', w_shadows: '{n}²-Schatten', w_ao: 'Umgebungsverdeckung', w_aoHigh: 'volle Umgebungsverdeckung',
    w_bloom: 'Bloom', w_reflections: 'Spiegelungen', w_noAa: 'keine Kantenglättung',
  },
  'fr-FR': {
    quality: 'Qualité', auto: 'Auto (détectée : {tier})', low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Flou lumineux', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage',
    reflections: 'Reflets', particles: 'Particules', background: 'Animation du ciel', detail: 'Détail des surfaces',
    off: 'Désactivé', on: 'Activé', medium: 'Moyenne',
    static: 'Statique', animated: 'Animé', plain: 'Simple', detailed: 'Détaillé',
    adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    postFailed: 'Le post-traitement est indisponible sur cet appareil ; les effets qui en dépendent sont ignorés.',
    unknownGpu: 'GPU inconnu',
    w_noShadows: 'sans ombres', w_shadows: 'ombres {n}²', w_ao: 'occlusion ambiante', w_aoHigh: 'occlusion ambiante complète',
    w_bloom: 'flou lumineux', w_reflections: 'reflets', w_noAa: 'sans anticrénelage',
  },
  'fr-CA': {
    quality: 'Qualité', auto: 'Auto (détectée : {tier})', low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Correction des couleurs', antialias: 'Anticrénelage',
    reflections: 'Reflets', particles: 'Particules', background: 'Animation du ciel', detail: 'Détail des surfaces',
    off: 'Désactivé', on: 'Activé', medium: 'Moyenne',
    static: 'Statique', animated: 'Animé', plain: 'Simple', detailed: 'Détaillé',
    adaptive: 'Résolution adaptative', showFps: 'Afficher le nombre d’images par seconde',
    postFailed: 'Le post-traitement n’est pas offert sur cet appareil; les effets qui en ont besoin sont omis.',
    unknownGpu: 'GPU inconnu',
    w_noShadows: 'sans ombres', w_shadows: 'ombres {n}²', w_ao: 'occlusion ambiante', w_aoHigh: 'occlusion ambiante complète',
    w_bloom: 'halo lumineux', w_reflections: 'reflets', w_noAa: 'sans anticrénelage',
  },
  'pt-BR': {
    quality: 'Qualidade', auto: 'Automática (detectada: {tier})', low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
    shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhado',
    reflections: 'Reflexos', particles: 'Partículas', background: 'Animação do céu', detail: 'Detalhe das superfícies',
    off: 'Desligado', on: 'Ligado', medium: 'Média',
    static: 'Estático', animated: 'Animado', plain: 'Simples', detailed: 'Detalhado',
    adaptive: 'Resolução adaptável', showFps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível neste dispositivo; os efeitos que dependem dele são ignorados.',
    unknownGpu: 'GPU desconhecida',
    w_noShadows: 'sem sombras', w_shadows: 'sombras {n}²', w_ao: 'oclusão de ambiente', w_aoHigh: 'oclusão de ambiente completa',
    w_bloom: 'brilho', w_reflections: 'reflexos', w_noAa: 'sem antisserrilhado',
  },
  'it-IT': {
    quality: 'Qualità', auto: 'Automatica (rilevata: {tier})', low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing',
    reflections: 'Riflessi', particles: 'Particelle', background: 'Animazione del cielo', detail: 'Dettaglio superfici',
    off: 'No', on: 'Sì', medium: 'Media',
    static: 'Statico', animated: 'Animato', plain: 'Semplice', detailed: 'Dettagliato',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti che la richiedono vengono saltati.',
    unknownGpu: 'GPU sconosciuta',
    w_noShadows: 'nessuna ombra', w_shadows: 'ombre {n}²', w_ao: 'occlusione ambientale', w_aoHigh: 'occlusione ambientale completa',
    w_bloom: 'bagliore', w_reflections: 'riflessi', w_noAa: 'nessun antialiasing',
  },
};

export const GFX_LOCALES = Object.keys(S);

const FALLBACK = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

export function pickLocale(langs) {
  const list = langs || (typeof navigator !== 'undefined' ? [...(navigator.languages || []), navigator.language] : []);
  for (const raw of list) {
    if (!raw) continue;
    const l = String(raw);
    const exact = GFX_LOCALES.find((k) => k.toLowerCase() === l.toLowerCase());
    if (exact) return exact;
    const lang = l.split('-')[0].toLowerCase();
    if (lang === 'es' && /-(ES)$/i.test(l)) return 'es-ES';
    if (lang === 'fr' && /-(CA)$/i.test(l)) return 'fr-CA';
    if (lang === 'en' && /-(GB|IE|AU|NZ|ZA|IN)$/i.test(l)) return 'en-GB';
    if (FALLBACK[lang]) return FALLBACK[lang];
  }
  return 'en-US';
}

/** Translator for the Graphics panel: t(key, {tier, n, …}). */
export function gfxStrings(locale = pickLocale()) {
  const table = { ...S['en-US'], ...(S[locale] || {}) };
  const t = (key, vars = {}) => {
    let s = table[key] ?? S['en-US'][key] ?? key;
    for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
    return s;
  };
  t.locale = locale;
  t.words = {
    noShadows: table.w_noShadows, shadows: table.w_shadows, ao: table.w_ao, aoHigh: table.w_aoHigh,
    bloom: table.w_bloom, reflections: table.w_reflections, noAa: table.w_noAa, px: table.w_px,
  };
  return t;
}

export const GFX_STRING_KEYS = Object.keys(S['en-US']);
export const GFX_STRINGS = S;
