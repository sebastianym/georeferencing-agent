'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { createSingleJob } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export function SingleAddressForm() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    setLoading(true);
    try {
      const { jobId } = await createSingleJob(address.trim());
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el job.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="address">Dirección</Label>
        <Textarea
          id="address"
          placeholder="Ej: Km 4 Vía Turbaco, al lado de la ferretería El Monito, Cartagena"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          disabled={loading}
        />
      </div>
      <Button
        type="submit"
        disabled={loading || !address.trim()}
        className="self-start bg-brand text-brand-foreground hover:bg-brand-hover"
      >
        {loading && <Loader2 className="animate-spin" />}
        Validar dirección
      </Button>
    </form>
  );
}
