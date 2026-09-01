'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createBulkJob } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Upload, FileSpreadsheet } from 'lucide-react';

export function BulkUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    try {
      const { jobId } = await createBulkJob(file);
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el archivo.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="file">Archivo CSV o JSON</Label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-muted/30 px-6 py-10 text-center transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          {file ? (
            <>
              <FileSpreadsheet className="size-8 text-muted-foreground" />
              <span className="text-sm font-medium">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB — click para cambiar
              </span>
            </>
          ) : (
            <>
              <Upload className="size-8 text-muted-foreground" />
              <span className="text-sm font-medium">Click para seleccionar un archivo</span>
              <span className="text-xs text-muted-foreground">
                Columna requerida: &quot;direccion&quot; (opcional: &quot;id&quot;)
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          id="file"
          type="file"
          accept=".csv,.json"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <Button
        type="submit"
        disabled={loading || !file}
        className="self-start bg-brand text-brand-foreground hover:bg-brand-hover"
      >
        {loading && <Loader2 className="animate-spin" />}
        Validar direcciones
      </Button>
    </form>
  );
}
