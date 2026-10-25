// Cloudflare Pages Function di Zampoo: gestisce POST /api/submit.
// Riceve i dati dei moduli Zampoo e li scrive in Airtable.
// Il token Airtable NON sta nel codice del sito: è un segreto di Cloudflare (AIRTABLE_TOKEN).

const BASE_ID_DEFAULT = 'appEALY9tdwCVXbSC';

// Quali tabelle e quali campi sono ammessi per ogni modulo.
const FORMS = {
  waitlist: {
    table: 'Iscritti',
    fields: ['Email', 'Ruolo', 'Fonte'],
    enums: { Ruolo: ['Proprietario', 'Dog Sitter'], Fonte: ['Hero', 'Footer'] },
    requireEmail: true,
    addDate: false,
  },
  sitter: {
    table: 'Interview Sitter',
    fields: [
      'Q1 - Situazione attuale', 'Q2 - Eta', 'Q3 - Esperienza cani', 'Q4 - Zone disponibilita',
      'Q5 - Ore settimana', 'Q6 - Fasce orarie', 'Q7 - Tipo servizio', 'Q8 - Motivazione',
      'Q9 - Tariffa desiderata', 'Q10 - Freni iscrizione', 'Q11 - Wishlist piattaforma', 'Email',
    ],
    requireEmail: false,
    addDate: true,
  },
  proprietari: {
    table: 'Interview Proprietari',
    fields: [
      'Q1 - Quanti cani', 'Q2 - Eta', 'Q3 - Frequenza bisogno', 'Q4 - Zona Milano',
      'Q5 - Come trova sitter', 'Q6 - Problema principale', 'Q7 - Rinunce per sitter',
      'Q8 - Cosa conta di piu', 'Q9 - Disponibilita prezzo', 'Q10 - Funzioni desiderate',
      'Q11 - Dubbi su Zampoo', 'Email',
    ],
    requireEmail: false,
    addDate: true,
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_LEN = 2000;
const MAX_BODY = 20000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS || 'https://zampoo.it,https://www.zampoo.it').split(',').map(s => s.trim());
  if (allowed.includes(origin)) return true;
  // anteprime di Cloudflare Pages (es. https://abc123.zampy-landing.pages.dev) e test locali
  try {
    const host = new URL(origin).hostname;
    return host.endsWith('.pages.dev') || host === 'localhost' || host === '127.0.0.1';
  } catch { return false; }
}

async function handleSubmit(request, env) {
  if (!originAllowed(request, env)) return json({ ok: false, error: 'origin' }, 403);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'too_large' }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  // Campo "trappola" per i bot: le persone non lo compilano mai
  if (body.website) return json({ ok: true }); // fingiamo successo, non salviamo nulla

  const form = FORMS[body.type];
  if (!form) return json({ ok: false, error: 'bad_type' }, 400);

  const input = body.fields && typeof body.fields === 'object' ? body.fields : {};
  const fields = {};
  for (const key of form.fields) {
    let v = input[key];
    if (v === undefined || v === null) continue;
    v = String(v).trim().slice(0, MAX_LEN);
    if (v === '') continue;
    if (form.enums && form.enums[key] && !form.enums[key].includes(v)) {
      return json({ ok: false, error: 'bad_value' }, 400);
    }
    fields[key] = v;
  }

  if (fields.Email && !EMAIL_RE.test(fields.Email)) return json({ ok: false, error: 'bad_email' }, 400);
  if (form.requireEmail && !fields.Email) return json({ ok: false, error: 'email_required' }, 400);
  if (Object.keys(fields).length === 0) return json({ ok: false, error: 'empty' }, 400);

  if (form.addDate) fields['Data'] = new Date().toISOString().split('T')[0];

  if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: 'not_configured' }, 500);
  const base = env.AIRTABLE_BASE || BASE_ID_DEFAULT;

  let res;
  try {
    res = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(form.table)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: false }),
    });
  } catch {
    return json({ ok: false, error: 'upstream_unreachable' }, 502);
  }
  if (!res.ok) return json({ ok: false, error: 'upstream_error' }, 502);
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  return handleSubmit(request, env);
}

// Qualsiasi altro metodo su /api/submit
export async function onRequest({ env }) {
  return json({ ok: false, error: 'method', configured: !!env.AIRTABLE_TOKEN }, 405);
}

