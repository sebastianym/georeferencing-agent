'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listJobs, type JobRecord } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { ArrowRight, History, Layers, MapPin } from 'lucide-react';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryList() {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);

  useEffect(() => {
    listJobs()
      .then((res) => setJobs(res.jobs))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'No se pudo cargar el historial.');
        setJobs([]);
      });
  }, []);

  if (jobs === null) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <History className="size-8" />
        <p>Todavía no hay validaciones registradas.</p>
        <Link href="/" className="text-sm text-brand hover:underline">
          Empezar una nueva
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y rounded-lg border bg-background">
      {jobs.map((job) => (
        <Link
          key={job.jobId}
          href={`/jobs/${job.jobId}`}
          className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {job.sourceType === 'bulk' ? <Layers className="size-4" /> : <MapPin className="size-4" />}
            </span>
            <div>
              <p className="font-medium">
                Validación {job.sourceType === 'bulk' ? 'masiva' : 'individual'} · {job.totalCount}{' '}
                {job.totalCount === 1 ? 'dirección' : 'direcciones'}
              </p>
              <p className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden text-[11px] sm:inline-flex">
              {job.jobId.slice(0, 8)}
            </Badge>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      ))}
    </div>
  );
}
