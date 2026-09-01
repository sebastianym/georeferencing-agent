import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const ADDRESSES_TABLE = process.env.ADDRESSES_TABLE!;
const HERE_SECRET_ARN = process.env.HERE_SECRET_ARN!;

let cachedApiKey: string | undefined;

async function getHereApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: HERE_SECRET_ARN }));
  const parsed = JSON.parse(res.SecretString ?? '{}');
  cachedApiKey = parsed.apiKey;
  if (!cachedApiKey) throw new Error('HERE api key missing in secret');
  return cachedApiKey;
}

interface HereScoring {
  queryScore: number;
  fieldScore?: Record<string, unknown>;
}

interface HereItem {
  title: string;
  resultType: string;
  address: { label: string };
  position?: { lat: number; lng: number };
  scoring: HereScoring;
}

/**
 * Maps HERE's resultType (the granularity HERE was actually able to resolve)
 * to a label a non-technical user understands. This is what makes the
 * client's "the range is too wide" complaint visible in the UI, separate
 * from the raw score.
 */
function detailLevelFromResultType(resultType: string | undefined): string {
  switch (resultType) {
    case 'houseNumber':
      return 'Dirección exacta';
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

interface Event {
  jobId: string;
  addressId: string;
}

export const handler = async (event: Event) => {
  const { jobId, addressId } = event;

  const item = await ddb.send(
    new GetCommand({ TableName: ADDRESSES_TABLE, Key: { jobId, addressId } })
  );
  const originalText: string | undefined = item.Item?.originalText;
  if (!originalText) {
    throw new Error(`Address ${jobId}/${addressId} has no originalText`);
  }

  const apiKey = await getHereApiKey();
  const url = new URL('https://geocode.search.hereapi.com/v1/geocode');
  url.searchParams.set('q', originalText);
  url.searchParams.set('in', 'countryCode:COL');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HERE geocode request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { items: HereItem[] };
  const best = body.items?.[0];

  const now = new Date().toISOString();

  if (!best) {
    await ddb.send(
      new UpdateCommand({
        TableName: ADDRESSES_TABLE,
        Key: { jobId, addressId },
        UpdateExpression:
          'SET #status = :status, precisionBefore = :zero, detailLevelBefore = :notFound, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'NOT_FOUND',
          ':zero': 0,
          ':notFound': 'No encontrado',
          ':now': now,
        },
      })
    );
    return { addressId, precisionBefore: 0 };
  }

  const precisionBefore = Math.round(best.scoring.queryScore * 100);
  const detailLevelBefore = detailLevelFromResultType(best.resultType);

  await ddb.send(
    new UpdateCommand({
      TableName: ADDRESSES_TABLE,
      Key: { jobId, addressId },
      UpdateExpression:
        'SET #status = :status, precisionBefore = :precision, detailLevelBefore = :detail, hereResultBefore = :here, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'VALIDATED',
        ':precision': precisionBefore,
        ':detail': detailLevelBefore,
        ':here': {
          label: best.address.label,
          resultType: best.resultType,
          position: best.position,
          queryScore: best.scoring.queryScore,
        },
        ':now': now,
      },
    })
  );

  return { addressId, precisionBefore };
};
