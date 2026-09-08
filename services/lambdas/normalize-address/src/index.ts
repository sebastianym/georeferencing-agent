import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const bedrock = new BedrockRuntimeClient({});

const ADDRESSES_TABLE = process.env.ADDRESSES_TABLE!;
const HERE_SECRET_ARN = process.env.HERE_SECRET_ARN!;
const GOOGLE_MAPS_SECRET_ARN = process.env.GOOGLE_MAPS_SECRET_ARN!;
const ARCGIS_SECRET_ARN = process.env.ARCGIS_SECRET_ARN!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID!;
const GUARDRAIL_ID = process.env.GUARDRAIL_ID!;
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION!;

const secretCache = new Map<string, string>();

async function getApiKey(secretArn: string, label: string): Promise<string> {
  const cached = secretCache.get(secretArn);
  if (cached) return cached;
  const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const apiKey = JSON.parse(res.SecretString ?? '{}').apiKey;
  if (!apiKey) throw new Error(`${label} api key missing in secret`);
  secretCache.set(secretArn, apiKey);
  return apiKey;
}

const getHereApiKey = () => getApiKey(HERE_SECRET_ARN, 'HERE');
const getGoogleMapsApiKey = () => getApiKey(GOOGLE_MAPS_SECRET_ARN, 'Google Maps');
const getArcgisApiKey = () => getApiKey(ARCGIS_SECRET_ARN, 'ArcGIS');

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

// Common shape every geocoding provider's winning candidate gets normalized
// into, so the rest of the pipeline (DynamoDB write, frontend) never needs to
// know which one actually produced it.
interface GeoWinner {
  label: string;
  resultType: string;
  position?: { lat: number; lng: number };
}

type GeoSource = 'geocode' | 'autosuggest' | 'google' | 'arcgis' | 'none';

interface ResolveResult {
  winner?: GeoWinner;
  precision: number;
  detailLevel: string;
  source: GeoSource;
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

async function resolveWithHere(
  apiKey: string,
  normalizedAddress: string,
  originalText: string
): Promise<ResolveResult> {
  // Two independent lookups, best candidate wins. /geocode is the reliable
  // choice for structured addresses (street + house number); /autosuggest
  // is the one that can land on a named business/landmark when that's the
  // only real signal in the address (which /geocode simply ignores).
  const geocodeResult = await geocode(apiKey, normalizedAddress);
  const placeResult = await autosuggestPlace(apiKey, normalizedAddress, geocodeResult?.position);

  const geocodeScore = geocodeResult ? Math.round((geocodeResult.scoring?.queryScore ?? 0) * 100) : -1;
  const placeScore = placeResult ? scorePlaceMatch(placeResult, originalText) : -1;

  const useCandidate: GeoSource = placeScore > geocodeScore ? 'autosuggest' : geocodeResult ? 'geocode' : 'none';

  const winnerItem = useCandidate === 'autosuggest' ? placeResult : geocodeResult;
  const precision = useCandidate === 'autosuggest' ? placeScore : Math.max(geocodeScore, 0);
  const detailLevel = winnerItem ? detailLevelFromResultType(winnerItem.resultType) : 'No encontrado';

  return {
    winner: winnerItem
      ? { label: winnerItem.address.label, resultType: winnerItem.resultType, position: winnerItem.position }
      : undefined,
    precision,
    detailLevel,
    source: useCandidate,
  };
}

// --- Secondary geocoders: only consulted when HERE's result falls short of
// GOOD_ENOUGH_PRECISION (see resolveAddress below). Each maps its own native
// confidence/category vocabulary onto the same 0-100 scale and Spanish detail
// labels HERE already uses, so a candidate from any provider is comparable.

function detailLevelFromGoogleTypes(types: string[] | undefined): string {
  const set = new Set(types ?? []);
  if (set.has('street_address') || set.has('premise') || set.has('subpremise')) return 'Dirección exacta';
  if (set.has('route')) return 'Calle';
  if (set.has('intersection')) return 'Intersección';
  if (set.has('point_of_interest') || set.has('establishment')) return 'Punto de interés';
  if (set.has('neighborhood') || set.has('sublocality')) return 'Barrio / distrito';
  if (set.has('locality')) return 'Ciudad';
  if (set.has('postal_code')) return 'Código postal';
  if (set.has('administrative_area_level_1') || set.has('administrative_area_level_2')) return 'Región';
  return 'No determinado';
}

// Google's Geocoding API doesn't return a numeric confidence, only a
// geometry.location_type category — this is the closest honest mapping onto
// our 0-100 scale (ROOFTOP is a real building match; APPROXIMATE can be as
// coarse as a city centroid).
function precisionFromGoogleLocationType(locationType: string | undefined): number {
  switch (locationType) {
    case 'ROOFTOP':
      return 95;
    case 'RANGE_INTERPOLATED':
      return 80;
    case 'GEOMETRIC_CENTER':
      return 55;
    case 'APPROXIMATE':
      return 35;
    default:
      return 0;
  }
}

interface GoogleGeocodeResponse {
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number }; location_type: string };
    types: string[];
  }>;
}

async function resolveWithGoogle(apiKey: string, text: string): Promise<ResolveResult> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', text);
  url.searchParams.set('components', 'country:CO');
  url.searchParams.set('language', 'es');
  url.searchParams.set('key', apiKey);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google geocode request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as GoogleGeocodeResponse;
  const result = body.results?.[0];
  if (!result) return { precision: 0, detailLevel: 'No encontrado', source: 'none' };

  return {
    winner: {
      label: result.formatted_address,
      resultType: result.geometry.location_type,
      position: result.geometry.location,
    },
    precision: precisionFromGoogleLocationType(result.geometry.location_type),
    detailLevel: detailLevelFromGoogleTypes(result.types),
    source: 'google',
  };
}

function detailLevelFromArcgisAddrType(addrType: string | undefined): string {
  switch (addrType) {
    case 'PointAddress':
    case 'StreetAddress':
      return 'Dirección exacta';
    case 'StreetName':
      return 'Calle';
    case 'Intersection':
      return 'Intersección';
    case 'POI':
      return 'Punto de interés';
    case 'Neighborhood':
      return 'Barrio / distrito';
    case 'Locality':
      return 'Ciudad';
    case 'Postal':
      return 'Código postal';
    default:
      return 'No determinado';
  }
}

interface ArcgisCandidatesResponse {
  candidates: Array<{
    address: string;
    location: { x: number; y: number };
    score: number;
    attributes: { Addr_type: string };
  }>;
}

async function resolveWithArcGIS(apiKey: string, text: string): Promise<ResolveResult> {
  const url = new URL('https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates');
  url.searchParams.set('SingleLine', text);
  url.searchParams.set('f', 'json');
  url.searchParams.set('token', apiKey);
  url.searchParams.set('countryCode', 'COL');
  url.searchParams.set('outFields', 'Addr_type');
  url.searchParams.set('maxLocations', '1');
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`ArcGIS geocode request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as ArcgisCandidatesResponse;
  const result = body.candidates?.[0];
  if (!result) return { precision: 0, detailLevel: 'No encontrado', source: 'none' };

  return {
    winner: {
      label: result.address,
      resultType: result.attributes.Addr_type,
      // ArcGIS returns location as x/y (lng/lat), not lat/lng.
      position: { lat: result.location.y, lng: result.location.x },
    },
    precision: Math.round(result.score),
    detailLevel: detailLevelFromArcgisAddrType(result.attributes.Addr_type),
    source: 'arcgis',
  };
}

// A HERE match at or above this is treated as good enough to stop — below
// it, the cascade pays for a second (and if needed third) opinion from
// Google/ArcGIS and keeps whichever result scores highest. Keeps the common
// case (HERE already nails it) cheap and fast, and only spends the extra
// calls on the addresses that actually need them.
const GOOD_ENOUGH_PRECISION = 90;

async function resolveAddress(
  apiKeys: { here: string; google: string; arcgis: string },
  normalizedAddress: string,
  originalText: string
): Promise<ResolveResult> {
  let best = await resolveWithHere(apiKeys.here, normalizedAddress, originalText);

  if (best.precision < GOOD_ENOUGH_PRECISION) {
    const google = await resolveWithGoogle(apiKeys.google, normalizedAddress).catch((err) => {
      console.log('GOOGLE_GEOCODE_ERROR', String(err));
      return undefined;
    });
    if (google && google.precision > best.precision) best = google;
  }

  if (best.precision < GOOD_ENOUGH_PRECISION) {
    const arcgis = await resolveWithArcGIS(apiKeys.arcgis, normalizedAddress).catch((err) => {
      console.log('ARCGIS_GEOCODE_ERROR', String(err));
      return undefined;
    });
    if (arcgis && arcgis.precision > best.precision) best = arcgis;
  }

  return best;
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

  const apiKeys = {
    here: await getHereApiKey(),
    google: await getGoogleMapsApiKey(),
    arcgis: await getArcgisApiKey(),
  };

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
      const { winner, precision, detailLevel, source } = await resolveAddress(
        apiKeys,
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
              ? { label: winner.label, resultType: winner.resultType, position: winner.position }
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
