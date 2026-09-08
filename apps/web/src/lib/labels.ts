import type { AddressStatus } from '@/lib/api';

export const STATUS_LABELS: Record<AddressStatus, string> = {
  PENDING: 'Validando',
  VALIDATED: 'Validada',
  NOT_FOUND: 'No encontrada',
  NORMALIZED: 'Optimizada',
  NO_IMPROVEMENT: 'Sin mejora',
  FAILED_GUARDRAIL: 'Bloqueada',
};
