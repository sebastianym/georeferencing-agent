'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PrecisionIndicator } from '@/components/app/precision-indicator';
import { AddressMap, type MapPoint } from '@/components/app/address-map';
import { AddressAuditPanel } from '@/components/app/address-audit-panel';
import { getJob, normalizeAddresses, type JobDetail, type AddressRecord } from '@/lib/api';
import { precisionTone } from '@/lib/precision';
import { STATUS_LABELS } from '@/lib/labels';
import { downloadAddressesAsCsv, downloadAddressesAsJson } from '@/lib/export';
import { computeDensityCells, type DensityCell } from '@/lib/density';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  Hexagon,
  Loader2,
  MapPin,
  MapPinned,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

const IN_PROGRESS_STATUSES = new Set(['PENDING']);
const MAX_POST_NORMALIZE_POLLS = 40;
// Addresses can be sent to the agent whether HERE matched them poorly
// (VALIDATED) or not at all (NOT_FOUND) — those are exactly the ones that
// most need normalization, so they can't be excluded from selection.
const NORMALIZABLE_STATUSES = new Set(['VALIDATED', 'NOT_FOUND']);
// Addresses that already scored well on the first pass aren't worth sending
// to the agent — this cuts down volume (and Bedrock usage) on jobs where
// most rows are already fine.
const MIN_PRECISION_FOR_NORMALIZATION = 75;
const DEFAULT_MAP_LIMIT = 10;

function needsNormalization(addr: AddressRecord): boolean {
  return (
    NORMALIZABLE_STATUSES.has(addr.status) &&
    (addr.precisionBefore === undefined || addr.precisionBefore < MIN_PRECISION_FOR_NORMALIZATION)
  );
}

const TONE_COLOR: Record<'good' | 'medium' | 'low', string> = {
  good: '#10b981',
  medium: '#f59e0b',
  low: '#ef4444',
};

function statusBadge(status: AddressRecord['status']) {
  switch (status) {
    case 'PENDING':
      return <Badge variant="secondary">Validando…</Badge>;
    case 'NOT_FOUND':
      return <Badge variant="destructive">No encontrada</Badge>;
    case 'FAILED_GUARDRAIL':
      return <Badge variant="destructive">Bloqueada por validación</Badge>;
    case 'NORMALIZED':
      return <Badge className="bg-brand text-brand-foreground hover:bg-brand">{STATUS_LABELS.NORMALIZED}</Badge>;
    case 'NO_IMPROVEMENT':
      return <Badge variant="secondary">{STATUS_LABELS.NO_IMPROVEMENT}</Badge>;
    default:
      return <Badge variant="outline">Validada</Badge>;
  }
}

function bestPosition(addr: AddressRecord) {
  return addr.hereResultAfter?.position ?? addr.hereResultBefore?.position;
}

function bestPrecision(addr: AddressRecord) {
  return addr.precisionAfter ?? addr.precisionBefore;
}

function truncate(text: string, max = 46) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function JobView({ jobId }: { jobId: string }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [normalizing, setNormalizing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AddressRecord['status'] | null>(null);
  const [mapMode, setMapMode] = useState<'pins' | 'density'>('pins');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const postNormalizePolls = useRef(0);
  const pendingNormalizeIds = useRef<Set<string>>(new Set());

  const fetchJob = useCallback(async () => {
    try {
      const data = await getJob(jobId);
      setDetail(data);
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el job.');
      return null;
    }
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    if (!detail) return;

    const stillValidating = detail.addresses.some((a) => IN_PROGRESS_STATUSES.has(a.status));
    const stillNormalizing =
      normalizing &&
      postNormalizePolls.current < MAX_POST_NORMALIZE_POLLS &&
      detail.addresses.some(
        (a) => pendingNormalizeIds.current.has(a.addressId) && NORMALIZABLE_STATUSES.has(a.status)
      );

    if (!stillValidating && !stillNormalizing) {
      if (normalizing) setNormalizing(false);
      return;
    }

    const timeout = setTimeout(async () => {
      if (stillNormalizing) postNormalizePolls.current += 1;
      await fetchJob();
    }, 2000);

    return () => clearTimeout(timeout);
  }, [detail, fetchJob, normalizing]);

  const normalizableSelectedIds = useMemo(() => {
    if (!detail) return [];
    return Array.from(selected).filter((id) => {
      const addr = detail.addresses.find((a) => a.addressId === id);
      return addr && needsNormalization(addr);
    });
  }, [detail, selected]);

  const mapPoints = useMemo<MapPoint[]>(() => {
    if (!detail) return [];

    if (selected.size > 0) {
      return detail.addresses
        .filter((a) => selected.has(a.addressId))
        .flatMap((a) => {
          const points: MapPoint[] = [];
          if (a.hereResultBefore?.position) {
            points.push({
              id: `${a.addressId}-before`,
              label: `${truncate(a.originalText)} · antes (${a.precisionBefore ?? 0}%)`,
              position: a.hereResultBefore.position,
              color: TONE_COLOR.low,
            });
          }
          if (a.hereResultAfter?.position) {
            points.push({
              id: `${a.addressId}-after`,
              label: `${truncate(a.originalText)} · después (${a.precisionAfter ?? 0}%)`,
              position: a.hereResultAfter.position,
              color: TONE_COLOR.good,
            });
          }
          return points;
        });
    }

    return detail.addresses
      .map((addr) => ({ addr, position: bestPosition(addr) }))
      .filter((x): x is { addr: AddressRecord; position: { lat: number; lng: number } } => Boolean(x.position))
      .slice(0, DEFAULT_MAP_LIMIT)
      .map(({ addr, position }) => ({
        id: addr.addressId,
        label: `${truncate(addr.originalText)} (${bestPrecision(addr) ?? 0}%)`,
        position,
        color: TONE_COLOR[precisionTone(bestPrecision(addr))],
      }));
  }, [detail, selected]);

  // Density mode always reflects the full job, not the current selection —
  // it's meant to show geographic concentration across the whole batch.
  const densityCells = useMemo<DensityCell[]>(() => {
    if (!detail || mapMode !== 'density') return [];
    const positions = detail.addresses
      .map(bestPosition)
      .filter((p): p is { lat: number; lng: number } => Boolean(p));
    return computeDensityCells(positions);
  }, [detail, mapMode]);

  async function handleNormalize() {
    if (normalizableSelectedIds.length === 0) return;
    setNormalizing(true);
    postNormalizePolls.current = 0;
    pendingNormalizeIds.current = new Set(normalizableSelectedIds);
    try {
      await normalizeAddresses(jobId, normalizableSelectedIds);
      setSelected(new Set());
      await fetchJob();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo iniciar la optimización.');
      setNormalizing(false);
    }
  }

  function toggleOne(addressId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(addressId);
      else next.delete(addressId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (!detail) return;
    setSelected(
      checked ? new Set(detail.addresses.filter(needsNormalization).map((a) => a.addressId)) : new Set()
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  const { job, addresses, statusCounts } = detail;
  const eligibleCount = addresses.filter(needsNormalization).length;
  const allSelected = eligibleCount > 0 && selected.size === eligibleCount;
  const isValidating = (statusCounts.PENDING ?? 0) > 0;
  const visibleAddresses = statusFilter ? addresses.filter((a) => a.status === statusFilter) : addresses;

  function toggleStatusFilter(status: AddressRecord['status']) {
    setStatusFilter((prev) => (prev === status ? null : status));
  }

  function toggleExpanded(addressId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(addressId)) next.delete(addressId);
      else next.add(addressId);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col lg:w-1/2 lg:flex-none">
        <div className="flex shrink-0 flex-col gap-4 border-b bg-background px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link
                href="/"
                className="mb-1.5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" /> Nueva validación
              </Link>
              <h1 className="text-xl font-semibold tracking-tight">
                Job {job.sourceType === 'single' ? 'individual' : 'masivo'} · {job.totalCount}{' '}
                {job.totalCount === 1 ? 'dirección' : 'direcciones'}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusCounts).map(([status, count]) => {
                const isActive = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatusFilter(status as AddressRecord['status'])}
                    className="cursor-pointer"
                  >
                    <Badge
                      variant={isActive ? 'default' : 'outline'}
                      className={`text-[11px] transition-colors ${isActive ? 'bg-brand text-brand-foreground hover:bg-brand-hover' : 'hover:bg-muted'}`}
                    >
                      {STATUS_LABELS[status as AddressRecord['status']] ?? status}: {count}
                    </Badge>
                  </button>
                );
              })}
              {statusFilter && (
                <button
                  type="button"
                  onClick={() => setStatusFilter(null)}
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  Limpiar filtro
                </button>
              )}
            </div>
          </div>

          {isValidating && (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Validando direcciones…
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Marcá direcciones para verlas en el mapa, o para enviarlas al agente de optimización.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadAddressesAsCsv(addresses, jobId)}
                className="gap-1.5"
              >
                <Download className="size-3.5" /> CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadAddressesAsJson(addresses, jobId)}
                className="gap-1.5"
              >
                <Download className="size-3.5" /> JSON
              </Button>
              <Button
                onClick={handleNormalize}
                disabled={normalizableSelectedIds.length === 0 || normalizing}
                className="bg-brand text-brand-foreground hover:bg-brand-hover disabled:bg-primary/50"
              >
                {normalizing ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Optimizar seleccionadas ({normalizableSelectedIds.length})
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="overflow-x-auto rounded-lg border bg-background">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(c) => toggleAll(Boolean(c))}
                      disabled={eligibleCount === 0}
                    />
                  </TableHead>
                  <TableHead className="w-[25%]">Original</TableHead>
                  <TableHead className="w-36">Precisión (antes)</TableHead>
                  <TableHead className="w-[25%]">Optimizada</TableHead>
                  <TableHead className="w-36">Precisión (después)</TableHead>
                  <TableHead className="w-35">Estado</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAddresses.map((addr) => {
                  const isExpanded = expandedIds.has(addr.addressId);
                  return (
                  <Fragment key={addr.addressId}>
                  <TableRow
                    data-selected={selected.has(addr.addressId)}
                    className="data-[selected=true]:bg-primary/5"
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(addr.addressId)}
                        onCheckedChange={(c) => toggleOne(addr.addressId, Boolean(c))}
                      />
                    </TableCell>
                    <TableCell className="whitespace-normal wrap-break-word text-sm">
                      {addr.originalText}
                    </TableCell>
                    <TableCell>
                      <PrecisionIndicator precision={addr.precisionBefore} detailLevel={addr.detailLevelBefore} />
                    </TableCell>
                    <TableCell className="whitespace-normal wrap-break-word text-sm">
                      {addr.normalizedText ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-start gap-1">
                            <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                            {addr.normalizedText}
                          </span>
                          {addr.hereMatchSource === 'autosuggest' && (
                            <Badge variant="outline" className="w-fit gap-1 text-xs">
                              <MapPin className="size-3" /> vía búsqueda de lugares
                            </Badge>
                          )}
                          {(addr.hereMatchSource === 'google' || addr.hereMatchSource === 'arcgis') && (
                            <Badge variant="outline" className="w-fit gap-1 text-xs">
                              <MapPin className="size-3" /> vía fuente alternativa
                            </Badge>
                          )}
                          {addr.flaggedForReview && (
                            <Badge
                              variant="outline"
                              className="w-fit gap-1 border-amber-500 text-xs text-amber-600 dark:text-amber-400"
                              title={addr.agentReasoning}
                            >
                              <TriangleAlert className="size-3" /> Revisar
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {addr.precisionAfter !== undefined ? (
                        <PrecisionIndicator precision={addr.precisionAfter} detailLevel={addr.detailLevelAfter} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{statusBadge(addr.status)}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(addr.addressId)}
                        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={isExpanded ? 'Ocultar detalle de auditoría' : 'Ver detalle de auditoría'}
                      >
                        {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/20 p-3">
                        <AddressAuditPanel addr={addr} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <div className="flex h-80 shrink-0 flex-col border-t lg:h-auto lg:w-1/2 lg:flex-none lg:border-t-0 lg:border-l">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Mapa</span>
            <div className="flex overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setMapMode('pins')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors ${
                  mapMode === 'pins' ? 'bg-brand text-brand-foreground' : 'hover:bg-muted'
                }`}
              >
                <MapPinned className="size-3.5" /> Pines
              </button>
              <button
                type="button"
                onClick={() => setMapMode('density')}
                className={`flex items-center gap-1.5 border-l px-2.5 py-1 text-xs transition-colors ${
                  mapMode === 'density' ? 'bg-brand text-brand-foreground' : 'hover:bg-muted'
                }`}
              >
                <Hexagon className="size-3.5" /> Densidad
              </button>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {mapMode === 'density'
              ? `${densityCells.length} ${densityCells.length === 1 ? 'zona' : 'zonas'} · ${addresses.filter((a) => bestPosition(a)).length} direcciones geolocalizadas`
              : selected.size > 0
                ? `${selected.size} ${selected.size === 1 ? 'seleccionada' : 'seleccionadas'}`
                : `Mostrando hasta ${DEFAULT_MAP_LIMIT} · marcá filas para enfocar`}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <AddressMap
            points={mapPoints}
            hexagons={densityCells}
            mode={mapMode}
            className="h-full w-full"
            emptyMessage={
              mapMode === 'density'
                ? 'Todavía no hay direcciones con posición para agrupar.'
                : selected.size === 0
                  ? 'Todavía no hay direcciones con posición para mostrar.'
                  : 'Ninguna de las direcciones seleccionadas tiene una posición todavía.'
            }
          />
        </div>
      </div>
    </div>
  );
}
