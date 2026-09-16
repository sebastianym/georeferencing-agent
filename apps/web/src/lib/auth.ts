const REGION = process.env.NEXT_PUBLIC_AWS_REGION ?? 'us-east-1';
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '';
const COGNITO_ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
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

function saveFromAuthenticationResult(result: any): void {
  saveSession({
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresAt: Date.now() + result.ExpiresIn * 1000,
  });
}

export type LoginResult =
  | { ok: true }
  // Accounts created by an admin start with a Cognito-generated temporary
  // password and must be given a real one on first login before they can
  // do anything else — the caller (the login page) needs to catch this and
  // show a "set your password" step instead of treating it as a failure.
  | { ok: false; challenge: 'NEW_PASSWORD_REQUIRED'; email: string; session: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const data = await cognitoRequest('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });

  if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    return { ok: false, challenge: 'NEW_PASSWORD_REQUIRED', email, session: data.Session };
  }

  const result = data.AuthenticationResult;
  if (!result) throw new Error('No se pudo iniciar sesión.');
  saveFromAuthenticationResult(result);
  return { ok: true };
}

// Completes the NEW_PASSWORD_REQUIRED challenge from login() above and logs
// the user in with the password they just set.
export async function completeNewPassword(email: string, newPassword: string, session: string): Promise<void> {
  const data = await cognitoRequest('RespondToAuthChallenge', {
    ClientId: CLIENT_ID,
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    Session: session,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  const result = data.AuthenticationResult;
  if (!result) throw new Error('No se pudo definir la contraseña.');
  saveFromAuthenticationResult(result);
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

async function ensureFreshSession(): Promise<StoredSession | null> {
  let session = loadSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() < 30_000) {
    session = await refreshSession(session);
    if (!session) {
      clearSession();
      return null;
    }
  }
  return session;
}

// Returns a currently-valid access token, transparently refreshing first if
// it's expired or about to expire. Callers attach this as a Bearer header.
export async function getAccessToken(): Promise<string | null> {
  const session = await ensureFreshSession();
  return session?.accessToken ?? null;
}

// The ID token carries the caller's verified email — the access token
// doesn't. Only needed for the admin user-creation call.
export async function getIdToken(): Promise<string | null> {
  const session = await ensureFreshSession();
  return session?.idToken ?? null;
}

export function isAuthenticated(): boolean {
  return loadSession() !== null;
}

export function logout(): void {
  clearSession();
}

// Creates a new account. Requires the caller to already be logged in as a
// @cnid.co user — enforced server-side (requireCnidCoAdmin), not just by
// hiding the /admin page from everyone else.
export async function adminCreateUser(email: string): Promise<void> {
  const [accessToken, idToken] = await Promise.all([getAccessToken(), getIdToken()]);
  if (!accessToken || !idToken) throw new Error('Tu sesión expiró. Volvé a iniciar sesión.');

  const res = await fetch(`${API_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Id-Token': idToken,
    },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? 'No se pudo crear el usuario.');
  }
}
