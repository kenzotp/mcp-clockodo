// Clockodo API client: auth headers, pagination, error mapping.
// Clockodo API docs: https://docs.clockodo.com (REST, base https://my.clockodo.com/api)
// Auth: X-ClockodoApiUser (login e-mail) + X-ClockodoApiKey per request header.

const BASE = "https://my.clockodo.com/api";

export class ClockodoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ClockodoClient {
  constructor(
    private apiUser: string,
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiUser || !apiKey) throw new Error("CLOCKODO_API_USER and CLOCKODO_API_KEY are required");
  }

  async get<T = any>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return this.request<T>(() => this.fetchImpl(url, { headers: this.headers() }));
  }

  async post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(() =>
      this.fetchImpl(BASE + path, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      }),
    );
  }

  async put<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(() =>
      this.fetchImpl(BASE + path, {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(body),
      }),
    );
  }

  async delete<T = any>(path: string): Promise<T> {
    return this.request<T>(() =>
      this.fetchImpl(BASE + path, { method: "DELETE", headers: this.headers() }),
    );
  }

  /** GET with Clockodo's page/pagination envelope: { paging: { items_per_page, current_page }, <data key> } */
  async list<T = any>(path: string, query: Record<string, string | number | undefined> = {}): Promise<{
    items: T[];
    page: number;
    totalPages: number;
  }> {
    const data = (await this.get<any>(path, query)) as any;
    const paging = data?.paging;
    // the data array is the first non-paging top-level array (entries/customers/projects/…)
    const key = Object.keys(data ?? {}).find(
      (k) => k !== "paging" && Array.isArray((data as any)[k]),
    );
    const items: T[] = key ? (data as any)[key] : [];
    return {
      items,
      page: paging?.current_page ?? 1,
      totalPages: paging?.total_pages ?? 1,
    };
  }

  private headers(): Record<string, string> {
    return {
      "X-ClockodoApiUser": this.apiUser,
      "X-ClockodoApiKey": this.apiKey,
      "content-type": "application/json",
    };
  }

  private async request<T>(doFetch: () => Promise<Response>): Promise<T> {
    const res = await doFetch().catch((err: unknown) => {
      throw new ClockodoError(0, `network error: ${err instanceof Error ? err.message : String(err)}`);
    });
    const text = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      // Clockodo error shape: { error: { message, code } } — surface it verbatim
      // so the LLM can react to the actual cause (validation, auth, limits).
      const msg =
        json?.error?.message ?? json?.error ?? text.slice(0, 200) ?? res.statusText;
      throw new ClockodoError(res.status, String(msg));
    }
    return json as T;
  }
}
