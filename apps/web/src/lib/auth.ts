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
    throw new Error(data.message ?? 'No se pudo iniciar sesión.');
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
