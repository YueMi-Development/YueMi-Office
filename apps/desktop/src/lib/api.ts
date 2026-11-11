import type {
  HealthResponse,
  OutlineEntry,
  RenderOutline,
  RenderRequest,
  RenderWarning,
} from '@yuemi/protocol';

import { DEFAULT_SERVICE_URL } from './serviceUrl';

/**
 * Where the render service lives.
 *
 * Defaults to a local service for development. The packaged app reads this
 * from its settings so the URL is never hardcoded into the bundle.
 */
const DEFAULT_BASE_URL = DEFAULT_SERVICE_URL;

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

function parseOutline(response: Response): RenderOutline | null {
  const header = response.headers.get('X-Outline');
  if (!header) {
    return null;
  }
  try {
    const parsed = JSON.parse(header) as Partial<RenderOutline>;
    return {
      entries: parsed.entries ?? [],
      pageCount: parsed.pageCount ?? 0,
    };
  } catch {
    return null;
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
 * the PDF the preview shows. The service sends it in a header, which means
 * the document is laid out once rather than twice.
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
  const outline = parseOutline(response);

  if (outline) {
    return { pdf, outline, warnings };
  }

  // The service did not send the outline, which happens when the document is
  // large enough for the header to be dropped. It is fetched separately so
  // the outline is never silently wrong.
  const fetched = await fetchOutline(request);
  return { pdf, outline: fetched, warnings };
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
