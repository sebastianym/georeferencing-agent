import Link from 'next/link';
import { HistoryList } from '@/components/app/history-list';
import { ArrowLeft } from 'lucide-react';

export default function HistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Link href="/" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Nueva validación
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Historial</h1>
        <p className="mt-1 text-muted-foreground">
          Validaciones individuales y cargas masivas que ya procesaste.
        </p>
      </div>
      <HistoryList />
    </div>
  );
}
