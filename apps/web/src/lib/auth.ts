const REGION = process.env.NEXT_PUBLIC_AWS_REGION ?? 'us-east-1';
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '';
const COGNITO_ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`;
const STORAGE_KEY = 'geoagent_session';

interface StoredSession {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing / storage disabled — session just won't persist.
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function cognitoRequest(action: string, body: unknown): Promise<any> {
  const res = await fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    // A PreSignUp Lambda rejection arrives wrapped as
    // "PreSignUp failed with error <our message>." — strip the wrapper so
    // the UI shows just the actual reason.
    const message: string = data.message ?? 'Ocurrió un error. Intentá de nuevo.';
    const unwrapped = message.match(/^PreSignUp failed with error (.+)$/)?.[1] ?? message;
    throw new Error(unwrapped);
  }
  return data;
}

export async function login(email: string, password: string): Promise<void> {
  const data = await cognitoRequest('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const result = data.AuthenticationResult;
  if (!result) throw new Error('No se pudo iniciar sesión.');
  saveSession({
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresAt: Date.now() + result.ExpiresIn * 1000,
  });
}

// Starts self-service sign-up. Cognito's PreSignUp trigger rejects the
// request server-side if the email's domain isn't allowed — that check
// can't be duplicated safely on the client, so a domain that looks wrong
// still gets sent and comes back as a normal error from this call.
export async function signUp(email: string, password: string): Promise<void> {
  await cognitoRequest('SignUp', {
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
}

// The code Cognito emailed after signUp() — confirms the account and
// marks the email verified. Login only works after this succeeds.
export async function confirmSignUp(email: string, code: string): Promise<void> {
  await cognitoRequest('ConfirmSignUp', {
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function resendConfirmationCode(email: string): Promise<void> {
  await cognitoRequest('ResendConfirmationCode', {
    ClientId: CLIENT_ID,
    Username: email,
  });
}

async function refreshSession(session: StoredSession): Promise<StoredSession | null> {
  try {
    const data = await cognitoRequest('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    const result = data.AuthenticationResult;
    if (!result) return null;
    const updated: StoredSession = {
      accessToken: result.AccessToken,
      idToken: result.IdToken ?? session.idToken,
      // Refresh tokens aren't rotated by this flow — the pool keeps issuing
      // new access/ID tokens against the same one until it expires.
      refreshToken: session.refreshToken,
      expiresAt: Date.now() + result.ExpiresIn * 1000,
    };
    saveSession(updated);
    return updated;
  } catch {
    return null;
  }
}

// Returns a currently-valid access token, transparently refreshing first if
// it's expired or about to expire. Callers attach this as a Bearer header.
export async function getAccessToken(): Promise<string | null> {
  let session = loadSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() < 30_000) {
    session = await refreshSession(session);
    if (!session) {
      clearSession();
      return null;
    }
  }
  return session.accessToken;
}

export function isAuthenticated(): boolean {
  return loadSession() !== null;
}

export function logout(): void {
  clearSession();
}
