import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SingleAddressForm } from '@/components/app/single-address-form';
import { BulkUploadForm } from '@/components/app/bulk-upload-form';
import { Gauge, ShieldCheck, Layers } from 'lucide-react';

const FEATURES = [
  { icon: Gauge, label: 'Precisión medible antes y después' },
  { icon: ShieldCheck, label: 'Agente con guardrails, sin inventar datos' },
  { icon: Layers, label: 'Direcciones individuales o en lote' },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="flex w-full max-w-2xl flex-col gap-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Agente de normalización de direcciones
          </h1>
          <p className="max-w-xl text-balance text-muted-foreground">
            Validá una dirección contra HERE, dejá que un agente con IA la normalice y comparé la
            precisión antes y después — sin inventar información que no esté en el texto original.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5 text-primary" />
                {label}
              </span>
            ))}
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Empezar</CardTitle>
            <CardDescription>Probá con una dirección individual o cargá un archivo masivo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="single">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="single">Individual</TabsTrigger>
                <TabsTrigger value="bulk">Carga masiva</TabsTrigger>
              </TabsList>
              <TabsContent value="single" className="pt-5">
                <SingleAddressForm />
              </TabsContent>
              <TabsContent value="bulk" className="pt-5">
                <BulkUploadForm />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
