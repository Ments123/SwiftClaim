export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  firm: { id: string; name: string };
  permissions: {
    canCreateMatter: boolean;
    canViewAdministration: boolean;
  };
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface MatterSummary {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  matterType: string;
  status: string;
  stage: string;
  riskLevel: string;
  openedAt: string;
  description: string;
  externalSource: string | null;
  externalId: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string };
  nextDeadline: string | null;
  openTaskCount: number;
}

export interface MatterTask {
  id: string;
  title: string;
  notes: string;
  dueAt: string;
  priority: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: { id: string; name: string };
}

export interface DashboardTask extends MatterTask {
  matterId: string;
  matter: { reference: string; title: string };
}

export interface Party {
  id: string;
  kind: string;
  name: string;
  organisation: string;
  email: string;
  phone: string;
  address: string;
  externalSource: string | null;
  externalId: string | null;
  createdAt: string;
}

export interface MatterDocument {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  latestVersion: null | {
    id: string;
    version: number;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
    uploadedByName: string;
  };
}

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  detail: string;
  actorName: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string;
  requestId: string;
  ipAddress: string;
  createdAt: string;
}

export interface MatterAggregate {
  matter: MatterSummary;
  parties: Party[];
  tasks: MatterTask[];
  documents: MatterDocument[];
  timeline: TimelineEvent[];
  audit: AuditEvent[];
  permissions: { canWrite: boolean; canCreateMatter: boolean };
  team: TeamMember[];
}

export interface DashboardData {
  summary: {
    activeMatters: number;
    overdueTasks: number;
    dueThisWeek: number;
    highRiskMatters: number;
  };
  urgentTasks: DashboardTask[];
  recentMatters: MatterSummary[];
  team: TeamMember[];
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? ((await response.json()) as ErrorPayload & T) : undefined;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.',
      payload?.error?.fields,
    );
  }
  return payload as T;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
