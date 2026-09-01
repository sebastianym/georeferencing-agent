import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { PutCommand, QueryCommand, GetCommand, BatchWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ddb, s3, sfn, env } from '../lib/aws-clients.js';
import { parseAddressFile, FileParseError, type ParsedAddressRow } from '../lib/parse-file.js';

const MAX_ROWS_PER_JOB = 5000;

async function createJobWithAddresses(rows: ParsedAddressRow[], sourceType: 'single' | 'bulk', sourceFileKey?: string) {
  const jobId = uuid();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: env.jobsTable,
      Item: {
        jobId,
        sourceType,
        sourceFileKey: sourceFileKey ?? null,
        totalCount: rows.length,
        status: 'VALIDATING',
        createdAt: now,
        updatedAt: now,
      },
    })
  );

  const items = rows.map((row) => ({ addressId: uuid(), ...row }));

  // BatchWrite in chunks of 25 (DynamoDB limit)
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [env.addressesTable]: chunk.map(({ addressId, originalText, externalId }) => ({
            PutRequest: {
              Item: {
                jobId,
                addressId,
                externalId: externalId ?? null,
                originalText,
                status: 'PENDING',
                createdAt: now,
                updatedAt: now,
              },
            },
          })),
        },
      })
    );
  }

  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: env.validationStateMachineArn,
      name: `validate-${jobId}`,
      input: JSON.stringify({
        items: items.map(({ addressId }) => ({ jobId, addressId })),
      }),
    })
  );

  return { jobId, totalCount: rows.length };
}

export default async function jobsRoutes(app: FastifyInstance) {
  app.post('/api/jobs/single', async (request, reply) => {
    const body = request.body as { address?: string };
    const address = body?.address?.trim();
    if (!address) {
      return reply.code(400).send({ error: 'El campo "address" es requerido.' });
    }
    const result = await createJobWithAddresses([{ originalText: address }], 'single');
    return reply.code(201).send(result);
  });

  app.post('/api/jobs/bulk', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'No se recibió ningún archivo.' });
    }
    const content = await file.toBuffer();

    let rows;
    try {
      rows = parseAddressFile(file.filename, content);
    } catch (err) {
      if (err instanceof FileParseError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    if (rows.length > MAX_ROWS_PER_JOB) {
      return reply
        .code(400)
        .send({ error: `El archivo tiene ${rows.length} filas; el máximo soportado en esta POC es ${MAX_ROWS_PER_JOB}.` });
    }

    const sourceFileKey = `uploads/${Date.now()}-${file.filename}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: env.dataBucket,
        Key: sourceFileKey,
        Body: content,
        ContentType: file.mimetype,
      })
    );

    const result = await createJobWithAddresses(rows, 'bulk', sourceFileKey);
    return reply.code(201).send(result);
  });

  // Simple Scan is fine at this POC's data volume; a GSI keyed by a constant
  // partition + createdAt would be the move if job counts grow much larger.
  app.get('/api/jobs', async (_request, reply) => {
    const result = await ddb.send(new ScanCommand({ TableName: env.jobsTable }));
    const jobs = (result.Items ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50);
    return reply.send({ jobs });
  });

  app.get('/api/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await ddb.send(new GetCommand({ TableName: env.jobsTable, Key: { jobId } }));
    if (!job.Item) return reply.code(404).send({ error: 'Job no encontrado.' });

    const addresses = await ddb.send(
      new QueryCommand({
        TableName: env.addressesTable,
        KeyConditionExpression: 'jobId = :jobId',
        ExpressionAttributeValues: { ':jobId': jobId },
      })
    );

    const items = addresses.Items ?? [];
    const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});

    return reply.send({ job: job.Item, addresses: items, statusCounts });
  });

  app.post('/api/jobs/:jobId/normalize', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const body = request.body as { addressIds?: string[] };
    const addressIds = body?.addressIds;
    if (!addressIds?.length) {
      return reply.code(400).send({ error: 'addressIds es requerido y no puede estar vacío.' });
    }

    const job = await ddb.send(new GetCommand({ TableName: env.jobsTable, Key: { jobId } }));
    if (!job.Item) return reply.code(404).send({ error: 'Job no encontrado.' });

    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: env.normalizationStateMachineArn,
        name: `normalize-${jobId}-${Date.now()}`,
        input: JSON.stringify({
          items: addressIds.map((addressId) => ({ jobId, addressId })),
        }),
      })
    );

    return reply.send({ jobId, normalizing: addressIds.length });
  });
}
