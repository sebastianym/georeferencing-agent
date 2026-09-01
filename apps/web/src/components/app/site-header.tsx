import Link from 'next/link';
import { Compass, History } from 'lucide-react';

export function SiteHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
          <Compass className="size-4" />
        </span>
        Agente de Georeferenciación
      </Link>
      <Link
        href="/history"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <History className="size-4" /> Historial
      </Link>
    </header>
  );
}
