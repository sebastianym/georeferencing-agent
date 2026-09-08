const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export interface HereResult {
  label: string;
  resultType: string;
  position?: { lat: number; lng: number };
}

export type AddressStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'NOT_FOUND'
  | 'NORMALIZED'
  | 'NO_IMPROVEMENT'
  | 'FAILED_GUARDRAIL';

export interface AddressRecord {
  jobId: string;
  addressId: string;
  externalId: string | null;
  originalText: string;
  status: AddressStatus;
  precisionBefore?: number;
  detailLevelBefore?: string;
  hereResultBefore?: HereResult;
  normalizedText?: string;
  agentReasoning?: string;
  precisionAfter?: number;
  detailLevelAfter?: string;
  hereResultAfter?: HereResult;
  hereMatchSource?: 'geocode' | 'autosuggest' | 'google' | 'arcgis' | 'none';
  flaggedForReview?: boolean;
}

export interface JobRecord {
  jobId: string;
  sourceType: 'single' | 'bulk';
  status: string;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobDetail {
  job: JobRecord;
  addresses: AddressRecord[];
  statusCounts: Record<string, number>;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Error ${res.status}`);
  }
  return res.json();
}

export async function createSingleJob(address: string): Promise<{ jobId: string; totalCount: number }> {
  const res = await fetch(`${API_URL}/api/jobs/single`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  return handleResponse(res);
}

export async function createBulkJob(file: File): Promise<{ jobId: string; totalCount: number }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_URL}/api/jobs/bulk`, { method: 'POST', body: formData });
  return handleResponse(res);
}

export async function getJob(jobId: string): Promise<JobDetail> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function listJobs(): Promise<{ jobs: JobRecord[] }> {
  const res = await fetch(`${API_URL}/api/jobs`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function normalizeAddresses(
  jobId: string,
  addressIds: string[]
): Promise<{ jobId: string; normalizing: number }> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/normalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addressIds }),
  });
  return handleResponse(res);
}
