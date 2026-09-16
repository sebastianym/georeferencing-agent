'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Compass, History, LogOut } from 'lucide-react';
import { isAuthenticated, logout } from '@/lib/auth';

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  // Read only after mount — localStorage doesn't exist during SSR, so
  // checking it during render would mismatch the server-rendered HTML.
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(isAuthenticated());
  }, [pathname]);

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
          <Compass className="size-4" />
        </span>
        Agente de Georeferenciación
      </Link>
      <div className="flex items-center gap-4">
        <Link
          href="/history"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <History className="size-4" /> Historial
        </Link>
        {pathname !== '/login' && authed && (
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        )}
      </div>
    </header>
  );
}
