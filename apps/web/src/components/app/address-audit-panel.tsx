import type { AddressRecord } from '@/lib/api';
import { getH3Cell } from '@/lib/density';

function qualityLabel(precision: number | undefined, detailLevel: string | undefined) {
  if (precision === undefined && !detailLevel) return '—';
  return `${detailLevel ?? '—'} (${(precision ?? 0).toFixed(1)}%)`;
}

function AuditRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,180px)_1fr] gap-4 border-b px-3 py-2 text-sm last:border-b-0 odd:bg-muted/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="wrap-break-word font-medium">{value}</span>
    </div>
  );
}

export function AddressAuditPanel({ addr }: { addr: AddressRecord }) {
  const position = addr.hereResultAfter?.position ?? addr.hereResultBefore?.position;

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <AuditRow label="Dirección cruda" value={addr.originalText} />
      <AuditRow label="Dirección detectada inicialmente" value={addr.hereResultBefore?.label ?? '—'} />
      <AuditRow label="Calidad inicial" value={qualityLabel(addr.precisionBefore, addr.detailLevelBefore)} />
      <AuditRow label="Dirección optimizada (IA)" value={addr.normalizedText ?? '— (sin cambios)'} />
      <AuditRow label="Calidad final optimizada" value={qualityLabel(addr.precisionAfter, addr.detailLevelAfter)} />
      <AuditRow
        label="Coordenada resuelta"
        value={position ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}` : '—'}
      />
      <AuditRow label="Código de zona" value={position ? getH3Cell(position) : '—'} />
    </div>
  );
}
