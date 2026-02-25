const authStatus = document.getElementById('auth-status');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const registerPasskeyBtn = document.getElementById('register-passkey-btn');
const refreshBtn = document.getElementById('refresh-btn');
const userCard = document.getElementById('user-card');
const tokenCard = document.getElementById('token-card');
const userInfo = document.getElementById('user-info');
const tokenInfo = document.getElementById('token-info');

const config = {
  issuer: 'http://localhost:9000/application/o/demo/',
  authorizationEndpoint: 'http://localhost:9000/application/o/authorize/',
  tokenEndpoint: 'http://localhost:9000/application/o/token/',
  userinfoEndpoint: 'http://localhost:9000/application/o/userinfo/',
  endSessionEndpoint: 'http://localhost:9000/application/o/demo/end-session/',
  clientId: 'demo-app',
  redirectUri: window.location.origin,
  scope: 'openid profile email offline_access',
  passkeyRegistrationUrl: 'http://localhost:9000/if/flow/default-authenticator-webauthn-setup/',
  passkeySetupUrl: 'http://localhost:9000/if/user/'
};

const urlOverrides = new URLSearchParams(window.location.search);
config.clientId = urlOverrides.get('client_id') || config.clientId;
config.passkeyRegistrationUrl = urlOverrides.get('passkey_register_url') || config.passkeyRegistrationUrl;
config.passkeySetupUrl = urlOverrides.get('passkey_setup_url') || config.passkeySetupUrl;

const TOKEN_STORAGE_KEY = 'authentik_tokens';
const CODE_VERIFIER_STORAGE_KEY = 'oidc_code_verifier';

function base64UrlEncode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

async function createCodeChallenge(codeVerifier) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

function parseJwt(jwt) {
  if (!jwt || typeof jwt !== 'string') {
    return null;
  }

  const parts = jwt.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(payload)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

function loadTokens() {
  const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearTokens() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function setAuthenticatedUi(tokens, claims) {
  authStatus.textContent = 'authenticated';
  loginBtn.disabled = true;
  logoutBtn.disabled = false;
  registerPasskeyBtn.disabled = false;
  refreshBtn.disabled = !tokens.refresh_token;
  userCard.hidden = false;
  tokenCard.hidden = false;

  userInfo.textContent = JSON.stringify(claims || {}, null, 2);
  tokenInfo.textContent = tokens.access_token || '';
}

function setLoggedOutUi() {
  authStatus.textContent = 'not authenticated';
  loginBtn.disabled = false;
  logoutBtn.disabled = true;
  registerPasskeyBtn.disabled = true;
  refreshBtn.disabled = true;
  userCard.hidden = true;
  tokenCard.hidden = true;
}

async function login() {
  const state = randomString(32);
  const nonce = randomString(32);
  const codeVerifier = randomString(96);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, codeVerifier);
  sessionStorage.setItem('oidc_state', state);
  sessionStorage.setItem('oidc_nonce', nonce);

  const authUrl = new URL(config.authorizationEndpoint);
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', config.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', config.scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  window.location.assign(authUrl.toString());
}

async function exchangeCodeForTokens(code) {
  const codeVerifier = sessionStorage.getItem(CODE_VERIFIER_STORAGE_KEY);
  const expectedState = sessionStorage.getItem('oidc_state');
  const url = new URL(window.location.href);
  const state = url.searchParams.get('state');

  if (!codeVerifier) {
    throw new Error('Missing code verifier. Start login again.');
  }

  if (!state || state !== expectedState) {
    throw new Error('Invalid state returned from provider.');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', config.clientId);
  body.set('redirect_uri', config.redirectUri);
  body.set('code', code);
  body.set('code_verifier', codeVerifier);

  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const tokens = await response.json();
  saveTokens(tokens);

  sessionStorage.removeItem(CODE_VERIFIER_STORAGE_KEY);
  sessionStorage.removeItem('oidc_state');
  sessionStorage.removeItem('oidc_nonce');

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('code');
  cleanUrl.searchParams.delete('state');
  cleanUrl.searchParams.delete('session_state');
  window.history.replaceState({}, document.title, cleanUrl.toString());

  return tokens;
}

async function refreshTokens() {
  const current = loadTokens();
  if (!current?.refresh_token) {
    throw new Error('No refresh token available.');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', config.clientId);
  body.set('refresh_token', current.refresh_token);

  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Refresh failed: ${response.status} ${errorText}`);
  }

  const refreshed = await response.json();
  const merged = {
    ...current,
    ...refreshed,
    refresh_token: refreshed.refresh_token || current.refresh_token
  };

  saveTokens(merged);
  return merged;
}

async function getClaims(tokens) {
  const idTokenClaims = parseJwt(tokens.id_token);
  if (!config.userinfoEndpoint || !tokens.access_token) {
    return idTokenClaims;
  }

  try {
    const response = await fetch(config.userinfoEndpoint, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`
      }
    });

    if (!response.ok) {
      return idTokenClaims;
    }

    const userinfo = await response.json();
    return { ...idTokenClaims, ...userinfo };
  } catch {
    return idTokenClaims;
  }
}

function logout() {
  const current = loadTokens();
  clearTokens();
  setLoggedOutUi();

  if (!config.endSessionEndpoint) {
    return;
  }

  const logoutUrl = new URL(config.endSessionEndpoint);
  logoutUrl.searchParams.set('post_logout_redirect_uri', config.redirectUri);

  if (current?.id_token) {
    logoutUrl.searchParams.set('id_token_hint', current.id_token);
  }

  window.location.assign(logoutUrl.toString());
}

function wireActions() {
  loginBtn.addEventListener('click', async () => {
    authStatus.textContent = 'redirecting to authentik';
    try {
      await login();
    } catch (error) {
      console.error(error);
      authStatus.textContent = String(error.message || error);
    }
  });

  refreshBtn.addEventListener('click', async () => {
    authStatus.textContent = 'refreshing token';
    try {
      const tokens = await refreshTokens();
      const claims = await getClaims(tokens);
      setAuthenticatedUi(tokens, claims);
    } catch (error) {
      console.error(error);
      authStatus.textContent = String(error.message || error);
      clearTokens();
      setLoggedOutUi();
    }
  });

  registerPasskeyBtn.addEventListener('click', () => {
    authStatus.textContent = 'opening passkey setup';
    const target = config.passkeyRegistrationUrl || config.passkeySetupUrl;
    window.location.assign(target);
  });

  logoutBtn.addEventListener('click', logout);
}

async function init() {
  wireActions();

  try {
    const url = new URL(window.location.href);
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    if (error) {
      authStatus.textContent = `${error}: ${errorDescription || 'authorization failed'}`;
      setLoggedOutUi();
      return;
    }

    const code = url.searchParams.get('code');
    let tokens = loadTokens();

    if (code) {
      authStatus.textContent = 'exchanging authorization code';
      tokens = await exchangeCodeForTokens(code);
    }

    if (!tokens?.access_token) {
      setLoggedOutUi();
      return;
    }

    const claims = await getClaims(tokens);
    setAuthenticatedUi(tokens, claims);
  } catch (error) {
    console.error(error);
    authStatus.textContent = String(error.message || error);
    clearTokens();
    setLoggedOutUi();
  }
}

init();
