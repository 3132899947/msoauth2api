const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const ALLOWED_MAILBOXES = new Map([
  ['INBOX', 'inbox'],
  ['Junk', 'junkemail'],
  ['inbox', 'inbox'],
  ['junkemail', 'junkemail']
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return env.ASSETS.fetch(new Request(new URL('/mail.html', url), request));
    }

    try {
      if (url.pathname === '/api/mail-new') return handleMailNew(request, env);
      if (url.pathname === '/api/mail-all') return handleMailAll(request, env);
      if (url.pathname === '/api/refresh-token') return handleRefreshToken(request, env);
      if (url.pathname === '/api/process-inbox') return handleProcessMailbox(request, env, 'inbox');
      if (url.pathname === '/api/process-junk') return handleProcessMailbox(request, env, 'junkemail');

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};

async function readParams(request) {
  const url = new URL(request.url);
  if (request.method === 'GET') return Object.fromEntries(url.searchParams.entries());

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return request.json();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries((await request.formData()).entries());
  }
  return {};
}

function checkPassword(params, env) {
  if (env.PASSWORD && params.password !== env.PASSWORD) {
    throw statusError('密码验证失败', 401);
  }
}

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

async function tokenRequest(body) {
  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Microsoft token response parse failed: ${text}`);
  }

  if (!response.ok) {
    throw new Error(data.error_description || data.error || text);
  }

  return data;
}

async function getGraphToken(refreshToken, clientId) {
  const data = await tokenRequest({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default'
  });

  if (!data.scope || !data.scope.includes('https://graph.microsoft.com/Mail.Read')) {
    throw new Error('当前 refresh_token 没有 Graph Mail.Read 权限，Cloudflare 版无法使用 IMAP 兜底');
  }

  return data.access_token;
}

function normalizeMailbox(mailbox) {
  const normalized = ALLOWED_MAILBOXES.get(mailbox);
  if (!normalized) throw statusError('Invalid mailbox. Allowed: INBOX, Junk', 400);
  return normalized;
}

function requireMailParams(params) {
  const { refresh_token, client_id, email, mailbox } = params;
  if (!refresh_token || !client_id || !email || !mailbox) {
    throw statusError('Missing required parameters: refresh_token, client_id, email, or mailbox', 400);
  }
  return { refresh_token, client_id, email, mailbox: normalizeMailbox(mailbox) };
}

function mapMessage(item) {
  return {
    id: item.id,
    send: item.from?.emailAddress?.address || '',
    subject: item.subject || '',
    text: item.bodyPreview || '',
    html: item.body?.content || '',
    date: item.receivedDateTime || item.createdDateTime || ''
  };
}

async function graphFetch(accessToken, path, init = {}) {
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });

  if (response.status === 204) return null;

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : data?.error?.message || text || `Graph API error ${response.status}`);
  }

  return data;
}

async function handleMailNew(request, env) {
  const params = await readParams(request);
  checkPassword(params, env);
  const { refresh_token, client_id, mailbox } = requireMailParams(params);
  const accessToken = await getGraphToken(refresh_token, client_id);
  const data = await graphFetch(accessToken, `/me/mailFolders/${mailbox}/messages?$top=1&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,body,receivedDateTime,createdDateTime`);
  const result = (data.value || []).map(mapMessage);
  return json(result);
}

async function handleMailAll(request, env) {
  const params = await readParams(request);
  checkPassword(params, env);
  const { refresh_token, client_id, mailbox } = requireMailParams(params);
  const top = Math.min(Math.max(parseInt(params.limit || '20', 10) || 20, 1), 50);
  const accessToken = await getGraphToken(refresh_token, client_id);
  const data = await graphFetch(accessToken, `/me/mailFolders/${mailbox}/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,body,receivedDateTime,createdDateTime`);
  return json((data.value || []).map(mapMessage));
}

async function handleRefreshToken(request, env) {
  const params = await readParams(request);
  checkPassword(params, env);
  const { refresh_token, client_id } = params;
  if (!refresh_token || !client_id) throw statusError('Missing required parameters: refresh_token or client_id', 400);

  const data = await tokenRequest({
    client_id,
    grant_type: 'refresh_token',
    refresh_token,
    scope: 'https://graph.microsoft.com/.default'
  });

  return json({ refresh_token: data.refresh_token || refresh_token });
}

async function handleProcessMailbox(request, env, mailbox) {
  const params = await readParams(request);
  checkPassword(params, env);
  const { refresh_token, client_id, email } = params;
  if (!refresh_token || !client_id || !email) {
    throw statusError('Missing required parameters: refresh_token, client_id, or email', 400);
  }

  const accessToken = await getGraphToken(refresh_token, client_id);
  let deleted = 0;

  while (deleted < 200) {
    const data = await graphFetch(accessToken, `/me/mailFolders/${mailbox}/messages?$top=25&$select=id`);
    const messages = data.value || [];
    if (!messages.length) break;

    for (const message of messages) {
      await graphFetch(accessToken, `/me/messages/${encodeURIComponent(message.id)}`, { method: 'DELETE' });
      deleted += 1;
    }
  }

  return json({ message: 'Mailbox processed successfully', mailbox, deleted });
}
