import type { PreSignUpTriggerHandler } from 'aws-lambda';

// Cognito calls this before a self-service sign-up is accepted, and also
// before AdminCreateUser (the app's actual signup path — see auth-stack.ts).
// Account creation isn't restricted by domain: the real gate is that only an
// already-authenticated @cnid.co admin can call AdminCreateUser at all (see
// requireCnidCoAdmin in apps/api), and the target address can belong to
// whichever org is using the app. This is just a well-formed-email check, a
// server-side backstop that doesn't rely on the API remembering to validate
// the shape correctly.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email ?? '';

  if (!EMAIL_REGEX.test(email)) {
    // No trailing period — Cognito appends its own "." after this message
    // when it wraps it as UserLambdaValidationException.
    throw new Error('Ingresá un correo válido');
  }

  return event;
};
