// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a text of the battery nor the token: only our own words, error
// codes, HTTP statuses and the address.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** "18:02:05 UTC": an instant, never in the local time of a container. */
export const clock = (at) => `${new Date(at).toISOString().slice(11, 19)} UTC`;

/** Our words for an error code of src/sonnen/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  refused: { en: 'read token refused', fr: 'jeton de lecture refusé' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  server: { en: 'error of the battery', fr: 'erreur de la batterie' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_json: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an answer of a sonnenBatterie (is it the right address?)',
    fr: 'réponse qui n’est pas celle d’une sonnenBatterie (est-ce la bonne adresse ?)',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    ['http', 'server', 'refused', 'rate_limited'].includes(err?.code) &&
    Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const INDEX = {
  pv: { en: 'solar production index', fr: 'index de production solaire' },
};

/** The secondary endpoints, in our words. */
const ENDPOINT = {
  status: { en: 'status', fr: 'état' },
  latest: { en: 'latest data', fr: 'dernières données' },
  powermeter: { en: 'meters', fr: 'compteurs' },
  battery: { en: 'battery modules', fr: 'modules de batterie' },
};

const kwh = (value) => Math.round(value * 1000) / 1000;

const sentences = (lang, list) => list.map((n) => n[lang]).join(' ');
const both = (list) => ({ en: sentences('en', list), fr: sentences('fr', list) });

const heldLine = ({ name, direction, from, to }) =>
  direction === 'down'
    ? {
        en: `${INDEX[name].en}: dropped from ${kwh(from)} to ${kwh(to)} kWh, held back (the last accepted value is sent again).`,
        fr: `${INDEX[name].fr} : baisse de ${kwh(from)} à ${kwh(to)} kWh, retenue (la dernière valeur acceptée est renvoyée).`,
      }
    : {
        en: `${INDEX[name].en}: jumped from ${kwh(from)} to ${kwh(to)} kWh, held back (not sent to the energy monitoring).`,
        fr: `${INDEX[name].fr} : saut de ${kwh(from)} à ${kwh(to)} kWh, retenu (non envoyé au suivi énergétique).`,
      };

export const T = {
  problem: {
    address_missing: {
      en: 'Enter the IP address of the sonnenBatterie and its read token in the configuration.',
      fr: 'Saisissez l’adresse IP de la sonnenBatterie et son jeton de lecture dans la configuration.',
    },
    address_invalid: {
      en: 'The address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.50).',
      fr: 'L’adresse n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.50).',
    },
    token_missing: {
      en: 'Enter the read token of the battery (its web interface, Software-Integration, JSON API, Read API).',
      fr: 'Saisissez le jeton de lecture de la batterie (son interface web, Software-Integration, JSON API, Read API).',
    },
    token_invalid: {
      en: 'The read token is not valid (8 to 256 characters, no space): copy it again from the web interface of the battery.',
      fr: 'Le jeton de lecture n’est pas valide (8 à 256 caractères, sans espace) : recopiez-le depuis l’interface web de la batterie.',
    },
  },
  connecting: {
    en: 'Reading the sonnenBatterie…',
    fr: 'Lecture de la sonnenBatterie…',
  },
  /** Not read yet in this start: the next read. */
  waiting: (at) => ({
    en: `sonnenBatterie: next read at ${clock(at)}.`,
    fr: `sonnenBatterie : prochaine lecture à ${clock(at)}.`,
  }),
  refused: (address, refusal, wait) => ({
    en: `${address} refuses the read token (HTTP ${refusal.status}): check it in the web interface of the battery (Software-Integration, JSON API, Read API) and save it again. Without a change, new try in ${delay(wait).en}.`,
    fr: `${address} refuse le jeton de lecture (HTTP ${refusal.status}) : vérifiez-le dans l’interface web de la batterie (Software-Integration, JSON API, Read API) puis enregistrez-le de nouveau. Sans changement, nouvel essai dans ${delay(wait).fr}.`,
  }),
  failing: (address, err, wait) => ({
    en: `${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
    fr: `${address} n’a pas pu être lue (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
  }),
  paused: (address, pause, wait) => ({
    en: `${address} asks to wait (${reason(pause).en}): reads paused, new try in ${delay(wait).en}.`,
    fr: `${address} demande d’attendre (${reason(pause).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
  }),
  ok: (firmware, notes = []) =>
    both([
      {
        en: `sonnenBatterie answering${firmware ? ` (software ${firmware})` : ''}.`,
        fr: `La sonnenBatterie répond${firmware ? ` (logiciel ${firmware})` : ''}.`,
      },
      ...notes,
    ]),
  notes: {
    noDevice: {
      en: 'Create its device from the "Discover" tab to receive its values.',
      fr: 'Créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.',
    },
    missing: (list) => ({
      en: `Not read this time (error of the battery): ${list.map((n) => ENDPOINT[n].en).join(', ')}; the other values are up to date.`,
      fr: `Non lu cette fois (erreur de la batterie) : ${list.map((n) => ENDPOINT[n].fr).join(', ')} ; les autres valeurs sont à jour.`,
    }),
    held: (held) =>
      both([
        ...held.map(heldLine),
        {
          en: 'If it is right, click "Accept the held index" twice in the configuration of the integration (the first click lists, the second accepts exactly what was listed). Saving the configuration accepts nothing.',
          fr: 'Si c’est juste, cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic liste, le second accepte exactement ce qui a été listé). Enregistrer la configuration n’accepte rien.',
        },
      ]),
  },
  accept: {
    nothing: {
      en: 'No index is held back: nothing to accept.',
      fr: 'Aucun index n’est retenu : rien à accepter.',
    },
    confirm: (held, within) =>
      both([
        {
          en: 'A second click accepts exactly these values:',
          fr: 'Un second clic accepte exactement ces valeurs :',
        },
        ...held.map((h) =>
          h.direction === 'down'
            ? {
                en: `${INDEX[h.name].en}: ${kwh(h.from)} → ${kwh(h.to)} kWh (a drop: 0 kWh counted).`,
                fr: `${INDEX[h.name].fr} : ${kwh(h.from)} → ${kwh(h.to)} kWh (une baisse : 0 kWh compté).`,
              }
            : {
                en: `${INDEX[h.name].en}: ${kwh(h.from)} → ${kwh(h.to)} kWh (${kwh(h.to - h.from)} kWh counted at once).`,
                fr: `${INDEX[h.name].fr} : ${kwh(h.from)} → ${kwh(h.to)} kWh (${kwh(h.to - h.from)} kWh comptés d’un coup).`,
              },
        ),
        {
          en: `Click "Accept the held index" again, after a few seconds and within ${delay(within).en}, to accept them; accept only if this energy was real.`,
          fr: `Cliquez de nouveau sur « Accepter l’index retenu », après quelques secondes et dans les ${delay(within).fr}, pour les accepter ; n’acceptez que si cette énergie est réelle.`,
        },
      ]),
    done: (accepted, changed) =>
      both([
        ...accepted.map((h) => ({
          en: `Accepted: ${INDEX[h.name].en} ${kwh(h.to)} kWh, sent at the next read.`,
          fr: `Accepté : ${INDEX[h.name].fr} ${kwh(h.to)} kWh, envoyé à la prochaine lecture.`,
        })),
        ...(changed.length > 0
          ? [
              {
                en: `Not accepted, the value changed since the first click: ${changed.map((h) => INDEX[h.name].en).join('; ')}. Click again to list it.`,
                fr: `Non accepté, la valeur a changé depuis le premier clic : ${changed.map((h) => INDEX[h.name].fr).join(' ; ')}. Cliquez de nouveau pour la lister.`,
              },
            ]
          : []),
        { en: 'A different value stays held.', fr: 'Une autre valeur reste retenue.' },
      ]),
  },
  test: {
    /** The values of the last read, in short. */
    ok: (address, values, firmware) => {
      const en = [];
      const fr = [];
      if (values.usoc !== undefined) {
        en.push(`charge ${values.usoc} %`);
        fr.push(`charge ${values.usoc} %`);
      }
      if (values.batteryPower !== undefined) {
        en.push(`battery ${Math.round(values.batteryPower)} W`);
        fr.push(`batterie ${Math.round(values.batteryPower)} W`);
      }
      if (values.productionPower !== undefined) {
        en.push(`solar ${Math.round(values.productionPower)} W`);
        fr.push(`solaire ${Math.round(values.productionPower)} W`);
      }
      const soft = firmware
        ? { en: `, software ${firmware}`, fr: `, logiciel ${firmware}` }
        : { en: '', fr: '' };
      return {
        en: `${address}: sonnenBatterie, read token accepted${soft.en}${en.length ? ` (${en.join(', ')})` : ''}.`,
        fr: `${address} : sonnenBatterie, jeton de lecture accepté${soft.fr}${fr.length ? ` (${fr.join(', ')})` : ''}.`,
      };
    },
    failed: (address, err) => ({
      en: `${address}: ${reason(err).en}.`,
      fr: `${address} : ${reason(err).fr}.`,
    }),
    /** The button never reads sooner than the pace: what is known, and when the next read can be. */
    notNow: (at) => ({
      en: `Not asked now (never faster than the reading interval, a pause or a refusal): next read possible at ${clock(at)}.`,
      fr: `Non interrogée maintenant (jamais plus vite que l’intervalle de lecture, une pause ou un refus) : prochaine lecture possible à ${clock(at)}.`,
    }),
    lastRead: (at) => ({
      en: `Last read at ${clock(at)}.`,
      fr: `Dernière lecture à ${clock(at)}.`,
    }),
    slow: {
      en: 'The battery is slow to answer: look at the integration status in a minute.',
      fr: 'La batterie tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
    lines: (lines) => both(lines),
  },
};
