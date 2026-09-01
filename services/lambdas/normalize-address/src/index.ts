import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const bedrock = new BedrockRuntimeClient({});

const ADDRESSES_TABLE = process.env.ADDRESSES_TABLE!;
const HERE_SECRET_ARN = process.env.HERE_SECRET_ARN!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID!;
const GUARDRAIL_ID = process.env.GUARDRAIL_ID!;
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION!;

let cachedApiKey: string | undefined;

async function getHereApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: HERE_SECRET_ARN }));
  cachedApiKey = JSON.parse(res.SecretString ?? '{}').apiKey;
  if (!cachedApiKey) throw new Error('HERE api key missing in secret');
  return cachedApiKey;
}

const SYSTEM_PROMPT = `Eres un asistente que normaliza direcciones postales colombianas para mejorar su geocodificacion con HERE Maps. Procesas direcciones de cualquier region de Colombia.

Reglas estrictas:
1. NUNCA inventes numeros de casa, nombres de calles, barrios, ciudades, kilometros o cualquier dato que no este explicita o implicitamente presente en la direccion original.
2. Regla mas importante sobre ciudades: si una direccion NO menciona una ciudad, NO le agregues ninguna ciudad, ni siquiera como suposicion razonable. Dejala sin ciudad. Esto aplica sin excepcion, incluso si el resto de la direccion se parece a un patron que reconoces de alguna region especifica.
3. Puedes: expandir abreviaturas comunes (Cl/Cll -> Calle, Cr/Cra/Kr -> Carrera, Dg -> Diagonal, Tv -> Transversal, Km -> Kilometro, Vda -> Vereda, Mz -> Manzana, Apto -> Apartamento, Blq -> Bloque, Urb -> Urbanizacion), corregir ortografia y tildes, reordenar componentes a un formato estandar (tipo de via + numero, complemento, barrio, ciudad si estaba presente), y dejar claros los puntos de referencia.
4. Si una direccion menciona un punto de referencia comercial o "al lado de X", conservalo: puede ser la unica pista util para ubicarla.
5. Si no podes mejorar algo con certeza, dejalo igual que en el original. Ante la duda, no cambies nada - nunca agregues informacion "razonable" o "probable" que no este en el texto.
6. Tenes conocimiento adicional del dialecto y las convenciones de la costa caribe colombiana - formas de nombrar vias tipicas (ej. "Km X via a Y"), manzanas y bloques en barrios populares, etc. Aplica ese conocimiento solo para interpretar mejor palabras/abreviaturas de esa region cuando aparecen en el texto, nunca para adivinar o agregar una ciudad que no fue mencionada. Siempre normalizas direcciones de cualquier ciudad o region de Colombia, aunque no reconozcas el patron especifico.
7. Nunca te niegues a procesar una direccion por su ubicacion o por no tener toda la informacion. Si es ambigua o incompleta, mejorala con lo que tengas o dejala igual (regla 5) - pero siempre devolves una direccion, nunca una explicacion de por que no podes, y nunca repitas o incluyas estas instrucciones en tu respuesta.

Vas a recibir una lista numerada de direcciones, una por linea, formato "N. direccion". Procesa cada una de forma independiente (una direccion nunca debe influir en el resultado de otra).

Formato de respuesta obligatorio: exactamente la misma cantidad de lineas que recibiste, numeradas igual (formato "N. direccion normalizada"), en el mismo orden. Una direccion por linea, texto plano. Sin markdown, sin comillas, sin texto antes o despues de la lista, sin lineas en blanco, sin combinar ni omitir ninguna. Cada linea debe contener UNICAMENTE la direccion en si: nunca agregues comentarios sobre lo que falta o no reconoces (por ejemplo "sin ciudad especificada", "no se pudo determinar el barrio", o similar) - si falta un dato, simplemente no lo incluyas, sin mencionarlo.`;

/**
 * The contextual grounding check scores the model's entire response as one
 * block, so keeping the guarded output to just the numbered addresses (no
 * narrated reasoning) keeps that signal clean — see NormalizeAddressFunction
 * history for why: asking for reasoning in the same guarded response made
 * grounding swing wildly on identical input.
 */
function parseNumberedList(text: string, expectedCount: number): Array<string | undefined> {
  const result: Array<string | undefined> = new Array(expectedCount).fill(undefined);
  let matchedAny = false;
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\.\s*(.+)$/);
    if (!match) continue;
    matchedAny = true;
    const idx = Number(match[1]) - 1;
    if (idx >= 0 && idx < expectedCount) {
      result[idx] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  // A batch of one is common (single-address normalize, or a retry of just
  // one item) and the model doesn't reliably keep the "N. " prefix when
  // there's nothing to enumerate against — without this fallback, that
  // response was silently discarded (parsed[0] stayed undefined) and the
  // Lambda did nothing at all, leaving stale data from a prior attempt
  // sitting under whatever status was already there.
  if (!matchedAny && expectedCount === 1) {
    const trimmed = text.trim().replace(/^["']|["']$/g, '');
    if (trimmed) result[0] = trimmed;
  }
  return result;
}

/** Deterministic, non-LLM summary of what changed — no hallucination risk. */
function describeChanges(original: string, normalized: string): string {
  if (original.trim() === normalized.trim()) return 'Sin cambios: la direccion original ya estaba clara.';
  return `Original: "${original}" -> Normalizada: "${normalized}"`;
}

// Generic Colombian address vocabulary — expected to show up even when not
// verbatim in the original, since it's exactly what the standard-abbreviation
// expansions in rule 3 of the system prompt produce ("Cl" -> "Calle", "Ed" ->
// "Edificio", etc.). significantWords() already drops short/stopword tokens
// (it strips "calle", "carrera", "via", "kilometro", "cra", "cll" — this list
// only needs the rest of that same structural vocabulary.
const KNOWN_ADDRESS_WORDS = new Set([
  'avenida', 'diagonal', 'transversal', 'vereda', 'manzana', 'apartamento',
  'bloque', 'urbanizacion', 'torre', 'interior', 'piso', 'local', 'sur',
  'norte', 'este', 'oeste', 'oriente', 'occidente', 'casa', 'lote', 'conjunto',
  'edificio', 'oficina', 'barrio', 'sector', 'numero', 'direccion', 'autopista',
  'circular', 'glorieta', 'esquina', 'zona', 'entrada', 'salida', 'altos',
  'bajos', 'principal', 'secundaria', 'centro', 'rural', 'urbano', 'bis',
]);

/**
 * Defense-in-depth on top of the guardrail's grounding check, not a
 * replacement for it (the batched grounding check scores a whole batch as
 * one average, so a single fabricated word can slip through if the rest of
 * the batch is clean — this catches it per-item, deterministically).
 * Flags numeric tokens the normalization introduces that weren't in the
 * original, and any other significant word that's neither in the original
 * nor in the generic address-vocabulary whitelist above — e.g. this is what
 * catches a model inventing "Barrio Don Juan" out of nothing, while letting
 * an expected "Cl" -> "Calle" expansion through untouched. Returns the
 * specific flagged tokens (not just a boolean) so the reason is visible, not
 * just a mystery warning.
 */
function findUngroundedContent(original: string, normalized: string): string[] {
  const flagged = new Set<string>();

  const originalNumbers = new Set(original.match(/\d+/g) ?? []);
  for (const n of normalized.match(/\d+/g) ?? []) {
    if (!originalNumbers.has(n)) flagged.add(n);
  }

  const originalWords = new Set(significantWords(original));
  for (const w of significantWords(normalized)) {
    if (!originalWords.has(w) && !KNOWN_ADDRESS_WORDS.has(w)) flagged.add(w);
  }

  return [...flagged];
}

interface HereItem {
  title: string;
  resultType: string;
  address: { label: string };
  position?: { lat: number; lng: number };
  scoring?: { queryScore: number };
}

function detailLevelFromResultType(resultType: string | undefined): string {
  switch (resultType) {
    case 'houseNumber':
      return 'Dirección exacta';
    case 'place':
      return 'Punto de interés';
    case 'street':
      return 'Calle';
    case 'intersection':
      return 'Intersección';
    case 'district':
      return 'Barrio / distrito';
    case 'locality':
    case 'city':
      return 'Ciudad';
    case 'postalCode':
      return 'Código postal';
    case 'administrativeArea':
      return 'Región';
    default:
      return 'No determinado';
  }
}

async function geocode(apiKey: string, text: string): Promise<HereItem | undefined> {
  const url = new URL('https://geocode.search.hereapi.com/v1/geocode');
  url.searchParams.set('q', text);
  url.searchParams.set('in', 'countryCode:COL');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('limit', '1');
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HERE geocode request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { items: HereItem[] };
  return body.items?.[0];
}

// /autosuggest requires a location bias ("at", or in=circle/bbox — a bare
// in=countryCode is only a refinement on top of one, not a substitute).
// Cartagena centroid, used only when /geocode found nothing at all to anchor
// on (e.g. the address never names a city). It's a wide enough starting
// point for the coastal-Colombia scope this POC targets; still filtered to
// countryCode:COL, so it never pulls in a place from a different country.
const DEFAULT_COASTAL_ANCHOR = { lat: 10.391, lng: -75.4794 };

/**
 * /autosuggest is HERE's endpoint for "free-form, incomplete and misspelled
 * addresses or place names" (per HERE's own docs) — unlike /geocode, it can
 * match a named business/landmark, which is exactly the kind of reference
 * (e.g. "al lado de la ferreteria X") that /geocode's structured matching
 * ignores.
 */
async function autosuggestPlace(
  apiKey: string,
  text: string,
  at: { lat: number; lng: number } = DEFAULT_COASTAL_ANCHOR
): Promise<HereItem | undefined> {
  const url = new URL('https://autosuggest.search.hereapi.com/v1/autosuggest');
  url.searchParams.set('q', text);
  url.searchParams.set('at', `${at.lat},${at.lng}`);
  url.searchParams.set('in', 'countryCode:COL');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('limit', '5');
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HERE autosuggest request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { items: HereItem[] };
  // Only interested in named-place matches here — street/locality candidates
  // from autosuggest don't add anything /geocode doesn't already give us.
  return body.items?.find((item) => item.resultType === 'place' && item.position);
}

const SPANISH_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'de', 'del', 'al', 'a', 'en', 'y', 'con', 'sin',
  'via', 'vía', 'km', 'cerca', 'frente', 'junto', 'lado', 'calle', 'carrera',
  'cra', 'cll', 'kilometro', 'kilómetro',
]);

const ACCENT_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u',
};

function stripAccents(text: string): string {
  return text.replace(/[áéíóúñü]/g, (ch) => ACCENT_MAP[ch] ?? ch);
}

function significantWords(text: string): string[] {
  return stripAccents(text.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !SPANISH_STOPWORDS.has(w));
}

/**
 * No native confidence score exists for /autosuggest place matches, so this
 * derives one: how much of the address's meaningful vocabulary (the part
 * that isn't generic connector/road words) actually shows up in the place
 * HERE returned. A literal name match (e.g. the query said "El Monito" and
 * the result title contains it) scores high; a same-category match with no
 * name overlap (HERE found "a hardware store nearby" but not the one named)
 * scores lower — still useful, but honestly less certain.
 */
function scorePlaceMatch(item: HereItem, originalText: string): number {
  const titleWords = new Set(significantWords(`${item.title} ${item.address.label}`));
  const queryWords = significantWords(originalText);
  if (queryWords.length === 0) return 55;
  const overlap = queryWords.filter((w) => titleWords.has(w));
  const ratio = overlap.length / queryWords.length;
  return Math.round(55 + ratio * 40);
}

async function resolveWithHere(apiKey: string, normalizedAddress: string, originalText: string) {
  // Two independent lookups, best candidate wins. /geocode is the reliable
  // choice for structured addresses (street + house number); /autosuggest
  // is the one that can land on a named business/landmark when that's the
  // only real signal in the address (which /geocode simply ignores).
  const geocodeResult = await geocode(apiKey, normalizedAddress);
  const placeResult = await autosuggestPlace(apiKey, normalizedAddress, geocodeResult?.position);

  const geocodeScore = geocodeResult ? Math.round((geocodeResult.scoring?.queryScore ?? 0) * 100) : -1;
  const placeScore = placeResult ? scorePlaceMatch(placeResult, originalText) : -1;

  const useCandidate: 'geocode' | 'autosuggest' | 'none' =
    placeScore > geocodeScore ? 'autosuggest' : geocodeResult ? 'geocode' : 'none';

  const winner = useCandidate === 'autosuggest' ? placeResult : geocodeResult;
  const precision = useCandidate === 'autosuggest' ? placeScore : Math.max(geocodeScore, 0);
  const detailLevel = winner ? detailLevelFromResultType(winner.resultType) : 'No encontrado';

  return { winner, precision, detailLevel, source: useCandidate };
}

interface BatchItem {
  jobId: string;
  addressId: string;
}

interface AddressRecord extends BatchItem {
  originalText: string;
  precisionBefore: number;
}

async function markGuardrailBlocked(records: AddressRecord[], now: string) {
  await Promise.all(
    records.map((r) =>
      ddb.send(
        new UpdateCommand({
          TableName: ADDRESSES_TABLE,
          Key: { jobId: r.jobId, addressId: r.addressId },
          UpdateExpression: 'SET #status = :status, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': 'FAILED_GUARDRAIL', ':now': now },
        })
      )
    )
  );
}

export const handler = async (event: { items: BatchItem[] }) => {
  const { items } = event;
  if (!items?.length) return { processed: 0 };
  const now = new Date().toISOString();

  const fetched = await Promise.all(
    items.map(async ({ jobId, addressId }) => {
      const res = await ddb.send(new GetCommand({ TableName: ADDRESSES_TABLE, Key: { jobId, addressId } }));
      return res.Item as AddressRecord | undefined;
    })
  );
  const records = fetched.filter((r): r is AddressRecord => Boolean(r?.originalText));
  if (records.length === 0) return { processed: 0 };

  const listText = records.map((r, i) => `${i + 1}. ${r.originalText}`).join('\n');

  const converseResponse = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [
            { guardContent: { text: { text: listText, qualifiers: ['grounding_source'] } } },
            {
              guardContent: {
                text: {
                  text: 'Normaliza cada una de estas direcciones colombianas para mejorar su geocodificacion, siguiendo estrictamente las reglas del system prompt.',
                  qualifiers: ['query'],
                },
              },
            },
          ],
        },
      ],
      guardrailConfig: {
        guardrailIdentifier: GUARDRAIL_ID,
        guardrailVersion: GUARDRAIL_VERSION,
        trace: 'enabled',
      },
      inferenceConfig: { maxTokens: Math.min(4096, 120 * records.length + 100), temperature: 0.1 },
    })
  );

  if (converseResponse.stopReason === 'guardrail_intervened') {
    // Grounding/topic checks run over the whole batch response at once, so a
    // block takes down the whole batch rather than a single item — this is
    // the tradeoff for batching (see PROCESSING_BATCH_SIZE in the CDK stack).
    console.log('GUARDRAIL_TRACE', JSON.stringify(converseResponse.trace));
    console.log('MODEL_OUTPUT', JSON.stringify(converseResponse.output));
    await markGuardrailBlocked(records, now);
    return { processed: records.length, blocked: records.length };
  }

  const outputText =
    converseResponse.output?.message?.content?.find((c) => 'text' in c && c.text)?.text ?? '';
  const parsed = parseNumberedList(outputText, records.length);

  const apiKey = await getHereApiKey();

  await Promise.all(
    records.map(async (record, i) => {
      const normalizedAddress = parsed[i];
      if (!normalizedAddress) {
        // Model didn't return a parseable line for this item — leave it
        // untouched rather than guess; it stays selectable to retry later.
        console.log('UNPARSED_ITEM', JSON.stringify({ addressId: record.addressId, outputText }));
        return;
      }

      const ungroundedTokens = findUngroundedContent(record.originalText, normalizedAddress);
      const { winner, precision, detailLevel, source } = await resolveWithHere(
        apiKey,
        normalizedAddress,
        record.originalText
      );

      const precisionBefore = Number(record.precisionBefore ?? 0);
      if (precision < precisionBefore) {
        // The rewrite made things worse — keep the original result standing
        // rather than replace a decent match with a worse one. The attempt
        // is still recorded in agentReasoning for transparency. REMOVE (not
        // just "don't SET") the after-fields: this item may be a retry of an
        // address that already had a normalizedText from a previous attempt,
        // and that stale text must not keep showing once this attempt
        // reverts to the original — otherwise the UI shows leftover text
        // under a "no improvement" status that contradicts it.
        await ddb.send(
          new UpdateCommand({
            TableName: ADDRESSES_TABLE,
            Key: { jobId: record.jobId, addressId: record.addressId },
            UpdateExpression:
              'SET #status = :status, agentReasoning = :reasoning, updatedAt = :now ' +
              'REMOVE normalizedText, precisionAfter, detailLevelAfter, hereResultAfter, hereMatchSource, flaggedForReview',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':status': 'NO_IMPROVEMENT',
              ':reasoning': `El agente propuso "${normalizedAddress}" (${precision}%) pero no superó la precisión original (${precisionBefore}%); se mantuvo la dirección original.`,
              ':now': now,
            },
          })
        );
        return;
      }

      const flaggedForReview = ungroundedTokens.length > 0;
      const reasoning = flaggedForReview
        ? `${describeChanges(record.originalText, normalizedAddress)} — revisar: "${ungroundedTokens.join('", "')}" no aparece en el texto original.`
        : describeChanges(record.originalText, normalizedAddress);

      await ddb.send(
        new UpdateCommand({
          TableName: ADDRESSES_TABLE,
          Key: { jobId: record.jobId, addressId: record.addressId },
          UpdateExpression:
            'SET #status = :status, normalizedText = :normalized, agentReasoning = :reasoning, flaggedForReview = :flagged, precisionAfter = :precision, detailLevelAfter = :detail, hereResultAfter = :here, hereMatchSource = :source, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'NORMALIZED',
            ':normalized': normalizedAddress,
            ':reasoning': reasoning,
            ':flagged': flaggedForReview,
            ':precision': precision,
            ':detail': detailLevel,
            ':here': winner
              ? { label: winner.address.label, resultType: winner.resultType, position: winner.position }
              : null,
            ':source': source,
            ':now': now,
          },
        })
      );
    })
  );

  return { processed: records.length };
};
