import type { PreSignUpTriggerHandler } from 'aws-lambda';

// Cognito calls this before a self-service sign-up is accepted. Throwing
// rejects the sign-up outright (the client gets a generic error back); the
// email domain is the only thing checked here — Cognito's own email
// verification code (sent after this trigger allows the sign-up through)
// is what actually proves the person controls that inbox, so this is not a
// substitute for that, just a first filter on who gets that far.
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN ?? '').toLowerCase();

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = (event.request.userAttributes.email ?? '').toLowerCase();

  if (!ALLOWED_DOMAIN || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    // No trailing period — Cognito appends its own "." after this message
    // when it wraps it as UserLambdaValidationException.
    throw new Error(`El registro solo está disponible para correos @${ALLOWED_DOMAIN}`);
  }

  return event;
};
