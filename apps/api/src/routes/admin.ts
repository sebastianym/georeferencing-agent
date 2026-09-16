import type { FastifyInstance } from 'fastify';
import { AdminCreateUserCommand, UsernameExistsException } from '@aws-sdk/client-cognito-identity-provider';
import { cognito, env } from '../lib/aws-clients.js';
import { requireAuth, requireCnidCoAdmin } from '../lib/auth.js';

const ADMIN_EMAIL_DOMAIN = (process.env.ADMIN_EMAIL_DOMAIN ?? '').toLowerCase();

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);
  app.addHook('onRequest', requireCnidCoAdmin);

  app.post('/api/admin/users', async (request, reply) => {
    const body = request.body as { email?: string } | undefined;
    const email = body?.email?.trim().toLowerCase();

    if (!email || !email.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) {
      return reply.code(400).send({ error: `El correo debe pertenecer al dominio @${ADMIN_EMAIL_DOMAIN}.` });
    }

    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: env.userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
          // No SUPPRESS: Cognito emails the new user a temporary password
          // directly. They set their own permanent one on first login — the
          // admin creating the account never sees or chooses it.
        })
      );
      return reply.code(201).send({ email });
    } catch (err) {
      if (err instanceof UsernameExistsException) {
        return reply.code(409).send({ error: 'Ya existe una cuenta con ese correo.' });
      }
      request.log.error({ err }, 'admin create user failed');
      return reply.code(500).send({ error: 'No se pudo crear el usuario.' });
    }
  });
}
