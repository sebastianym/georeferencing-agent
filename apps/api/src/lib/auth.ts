import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { FastifyRequest, FastifyReply } from 'fastify';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

// Verifies the Cognito access token against the pool's public JWKS (cached
// by the verifier after the first call) — no AWS credentials or network
// calls to Cognito itself needed per request.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (!token) {
    return reply.code(401).send({ error: 'No autorizado.' });
  }
  try {
    await verifier.verify(token);
  } catch (err) {
    request.log.error({ err }, 'token verification failed');
    return reply.code(401).send({ error: 'Sesión inválida o expirada.' });
  }
}
