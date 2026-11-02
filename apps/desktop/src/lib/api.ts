import type {
  HealthResponse,
  OutlineEntry,
  RenderOutline,
  RenderRequest,
  RenderWarning,
} from '@yuemi/protocol';

/**
 * Where the render service lives.
 *
 * Defaults to a local service for development. The packaged app reads this
 * from its settings so the URL is never hardcoded into the bundle.
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

let baseUrl = DEFAULT_BASE_URL;

export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  return baseUrl;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: string;

  constructor(message: string, status: number, details?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function readError(response: Response): Promise<ApiError> {
  let details: string | undefined;
  try {
    const body = await response.json();
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      if (typeof record.details === 'string') {
        details = record.details;
      } else if (typeof record.error === 'string') {
        details = record.error;
      }
    }
  } catch {
    // The body was not JSON; the status text is the best we have.
  }
  return new ApiError(
    `Render service responded with ${response.status}`,
    response.status,
    details,
  );
}

function parseWarnings(response: Response): RenderWarning[] {
  const header = response.headers.get('X-Warnings');
  if (!header) {
    return [];
  }
  try {
    const parsed = JSON.parse(header);
    return Array.isArray(parsed) ? (parsed as RenderWarning[]) : [];
  } catch {
    return [];
  }
}

export interface RenderResult {
  pdf: Uint8Array;
  outline: RenderOutline;
  warnings: RenderWarning[];
}

/**
 * Renders a project and returns the PDF together with its outline.
 *
 * The outline comes from the same render, so its page numbers always match
 * the PDF the preview shows.
 */
export async function renderProject(request: RenderRequest): Promise<RenderResult> {
  const response = await fetch(`${baseUrl}/v1/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw await readError(response);
  }

  const pdf = new Uint8Array(await response.arrayBuffer());
  const warnings = parseWarnings(response);

  const outline = await fetchOutline(request);
  return { pdf, outline, warnings };
}

/**
 * Renders a project and returns only its outline.
 */
export async function fetchOutline(request: RenderRequest): Promise<RenderOutline> {
  const response = await fetch(`${baseUrl}/v1/render/outline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw await readError(response);
  }

  const body = (await response.json()) as RenderOutline;
  return {
    entries: body.entries ?? [],
    pageCount: body.pageCount ?? 0,
  };
}

/**
 * Checks that the render service is reachable.
 */
export async function checkHealth(): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/v1/health`);
  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as HealthResponse;
}

/**
 * Flattens the outline into a list, preserving document order.
 */
export function flattenOutline(entries: OutlineEntry[]): OutlineEntry[] {
  const result: OutlineEntry[] = [];

  const visit = (index: number) => {
    const entry = entries[index];
    if (!entry) {
      return;
    }
    result.push(entry);
    for (const child of entry.children ?? []) {
      visit(child);
    }
  };

  for (let index = 0; index < entries.length; index += 1) {
    visit(index);
  }

  return result;
}
