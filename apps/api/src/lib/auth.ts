import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { FastifyRequest, FastifyReply } from 'fastify';

const accessVerifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

// Access tokens don't carry the email claim (only ID tokens do), so the
// admin-only routes verify a second token — see requireCnidCoAdmin below.
const idVerifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

const ADMIN_EMAIL_DOMAIN = (process.env.ADMIN_EMAIL_DOMAIN ?? '').toLowerCase();

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
    await accessVerifier.verify(token);
  } catch (err) {
    request.log.error({ err }, 'token verification failed');
    return reply.code(401).send({ error: 'Sesión inválida o expirada.' });
  }
}

// Gate for the user-creation endpoint: on top of requireAuth (a valid
// session), this checks who that session actually belongs to — the
// caller's own verified email must be on the admin domain. Never trust the
// frontend's word for this; it's re-derived here from a signed ID token.
export async function requireCnidCoAdmin(request: FastifyRequest, reply: FastifyReply) {
  const idToken = request.headers['x-id-token'];
  if (typeof idToken !== 'string' || !idToken) {
    return reply.code(401).send({ error: 'No autorizado.' });
  }
  try {
    const payload = await idVerifier.verify(idToken);
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!ADMIN_EMAIL_DOMAIN || !email.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) {
      return reply.code(403).send({ error: 'No tenés permiso para crear usuarios.' });
    }
  } catch (err) {
    request.log.error({ err }, 'id token verification failed');
    return reply.code(401).send({ error: 'Sesión inválida o expirada.' });
  }
}
