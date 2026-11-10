export class SupabaseRest {
  constructor(config, fetchImpl = fetch) {
    this.url = config.SUPABASE_URL?.replace(/\/$/, "");
    this.anonKey = config.SUPABASE_ANON_KEY;
    this.serviceRoleKey = config.SUPABASE_SERVICE_ROLE_KEY;
    this.fetchImpl = fetchImpl;
  }

  async getUser(accessToken) {
    const response = await this.fetchImpl(`${this.url}/auth/v1/user`, {
      headers: { apikey: this.anonKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return undefined;
    const user = await response.json();
    return typeof user?.id === "string" ? { id: user.id, email: user.email ?? null } : undefined;
  }

  async userRequest(accessToken, table, method, query = {}, body, prefer = "") {
    return this.request(this.anonKey, accessToken, table, method, query, body, prefer);
  }

  async serviceRequest(table, method, query = {}, body, prefer = "") {
    return this.request(this.serviceRoleKey, this.serviceRoleKey, table, method, query, body, prefer);
  }

  async rpc(name, body) {
    const response = await this.fetchImpl(`${this.url}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    return parseResponse(response);
  }

  async request(apiKey, token, table, method, query = {}, body, prefer = "") {
    const url = new URL(`${this.url}/rest/v1/${encodeURIComponent(table)}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const headers = { apikey: apiKey, Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;
    const response = await this.fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12_000),
    });
    return parseResponse(response);
  }
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const error = new Error("Database request failed.");
    error.status = response.status;
    error.code = typeof body?.code === "string" ? body.code : "DATABASE_ERROR";
    throw error;
  }
  return body;
}
