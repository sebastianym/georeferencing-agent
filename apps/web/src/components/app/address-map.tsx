'use client';

import { useEffect, useRef, useState } from 'react';
import { densityColor, type DensityCell } from '@/lib/density';

declare global {
  interface Window {
    H: any;
  }
}

export interface MapPoint {
  id: string;
  label: string;
  position: { lat: number; lng: number };
  color: string;
}

function useHereMapsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.H?.service && window.H?.mapevents && window.H?.ui) {
      setReady(true);
      return;
    }
    const interval = setInterval(() => {
      if (window.H?.service && window.H?.mapevents && window.H?.ui) {
        setReady(true);
        clearInterval(interval);
      }
    }, 150);
    const timeout = setTimeout(() => clearInterval(interval), 10000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
  return ready;
}

function markerIcon(color: string) {
  return new window.H.map.Icon(
    `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="10" fill="${color}" stroke="white" stroke-width="3"/></svg>`
    )}`,
    { anchor: { x: 15, y: 15 } }
  );
}

export function AddressMap({
  points,
  hexagons,
  mode = 'pins',
  className,
  emptyMessage = 'Seleccioná direcciones validadas para verlas acá.',
}: {
  points: MapPoint[];
  hexagons?: DensityCell[];
  mode?: 'pins' | 'density';
  className?: string;
  emptyMessage?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const groupRef = useRef<any>(null);
  const bubbleRef = useRef<any>(null);
  const ready = useHereMapsReady();
  const apiKey = process.env.NEXT_PUBLIC_HERE_API_KEY;

  // Create the map once the SDK is ready. Markers are handled separately so
  // toggling the address selection doesn't tear down and rebuild the map.
  useEffect(() => {
    if (!ready || !containerRef.current || !apiKey || mapRef.current) return;

    const H = window.H;
    const platform = new H.service.Platform({ apikey: apiKey });
    const defaultLayers = platform.createDefaultLayers();
    const map = new H.Map(containerRef.current, defaultLayers.vector.normal.map, {
      zoom: 12,
      center: { lat: 10.391, lng: -75.4794 },
      pixelRatio: window.devicePixelRatio || 1,
    });
    mapRef.current = map;
    groupRef.current = new H.map.Group();
    map.addObject(groupRef.current);

    new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
    const ui = H.ui.UI.createDefault(map, defaultLayers);

    groupRef.current.addEventListener('tap', (evt: any) => {
      const marker = evt.target;
      bubbleRef.current?.close();
      bubbleRef.current = new H.ui.InfoBubble(marker.getGeometry(), { content: marker.getData() });
      ui.addBubble(bubbleRef.current);
    });

    const resize = () => map.getViewPort().resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      map.dispose();
      mapRef.current = null;
    };
  }, [ready, apiKey]);

  // Rebuild markers/hexagons whenever the data set or mode changes, and refit the view.
  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;

    const H = window.H;
    group.removeAll();

    if (mode === 'density') {
      if (!hexagons || hexagons.length === 0) return;
      const maxCount = Math.max(...hexagons.map((h) => h.count));
      for (const hex of hexagons) {
        const flat = hex.boundary.flatMap(({ lat, lng }) => [lat, lng, 0]);
        flat.push(hex.boundary[0].lat, hex.boundary[0].lng, 0);
        const lineString = new H.geo.LineString(flat);
        const color = densityColor(hex.count, maxCount);
        const polygon = new H.map.Polygon(new H.geo.Polygon(lineString), {
          style: { fillColor: `${color}99`, strokeColor: color, lineWidth: 1.5 },
        });
        polygon.setData(`${hex.count} ${hex.count === 1 ? 'dirección' : 'direcciones'}`);
        group.addObject(polygon);
      }
      map.getViewModel().setLookAtData({ bounds: group.getBoundingBox() });
      return;
    }

    if (points.length === 0) return;

    for (const point of points) {
      const marker = new H.map.Marker(point.position, { icon: markerIcon(point.color) });
      marker.setData(point.label);
      group.addObject(marker);
    }

    if (points.length === 1) {
      map.setCenter(points[0].position);
      map.setZoom(15);
    } else {
      map.getViewModel().setLookAtData({ bounds: group.getBoundingBox() });
    }
  }, [points, hexagons, mode]);

  if (!apiKey) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground">
        Falta NEXT_PUBLIC_HERE_API_KEY para mostrar el mapa.
      </div>
    );
  }

  const isEmpty = mode === 'density' ? !hexagons || hexagons.length === 0 : points.length === 0;

  return (
    <div className={`relative ${className ?? 'h-full w-full'}`}>
      <div ref={containerRef} className="h-full w-full bg-muted/20" />
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 p-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
