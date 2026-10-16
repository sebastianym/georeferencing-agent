import type { PreSignUpTriggerHandler } from 'aws-lambda';

// Cognito calls this before a self-service sign-up is accepted, and also
// before AdminCreateUser (the app's actual signup path — see auth-stack.ts).
// Throwing rejects the account creation outright. Two allowlists:
//  - ALLOWED_EMAIL_DOMAINS: comma-separated domains whose addresses can
//    always be created (the admin's own org plus whichever client org is
//    actually using the app — both administer/use it as of this deploy).
//  - ALLOWED_EMAILS: exact-match allowlist for the rare one-off address
//    outside those domains. Deliberately exact, not another open domain —
//    granting a single address doesn't let an admin onboard anyone else
//    at will the way a domain grant would.
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
  .toLowerCase()
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);
const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS ?? '')
    .toLowerCase()
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
);

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = (event.request.userAttributes.email ?? '').toLowerCase();

  const allowed = ALLOWED_EMAILS.has(email) || ALLOWED_DOMAINS.some((domain) => email.endsWith(`@${domain}`));

  if (!allowed) {
    // No trailing period — Cognito appends its own "." after this message
    // when it wraps it as UserLambdaValidationException.
    const domainsList = ALLOWED_DOMAINS.map((d) => `@${d}`).join(', ');
    throw new Error(`El registro solo está disponible para correos ${domainsList}`);
  }

  return event;
};
