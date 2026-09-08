import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/app/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agente de Georeferenciación",
  description: "Sanitización y optimización de direcciones con inteligencia artificial",
};

const HERE_MAPS_VERSION = "3.2";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href={`https://js.api.here.com/v3/${HERE_MAPS_VERSION}/mapsjs-ui.css`}
        />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-muted/20">
        {/* Loaded in order (core -> service -> mapevents -> ui); AddressMap
            polls for window.H readiness rather than wiring per-script
            onLoad callbacks, so strict ordering here is enough. */}
        <Script src={`https://js.api.here.com/v3/${HERE_MAPS_VERSION}/mapsjs-core.js`} strategy="afterInteractive" />
        <Script src={`https://js.api.here.com/v3/${HERE_MAPS_VERSION}/mapsjs-service.js`} strategy="afterInteractive" />
        <Script src={`https://js.api.here.com/v3/${HERE_MAPS_VERSION}/mapsjs-mapevents.js`} strategy="afterInteractive" />
        <Script src={`https://js.api.here.com/v3/${HERE_MAPS_VERSION}/mapsjs-ui.js`} strategy="afterInteractive" />
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
