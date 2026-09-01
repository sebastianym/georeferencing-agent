import { Progress } from '@/components/ui/progress';
import { precisionTone, precisionToneClasses, precisionToneBar } from '@/lib/precision';

export function PrecisionIndicator({
  precision,
  detailLevel,
}: {
  precision: number | undefined;
  detailLevel: string | undefined;
}) {
  const tone = precisionTone(precision);
  return (
    <div className="flex min-w-[140px] flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-semibold ${precisionToneClasses[tone]}`}>
          {precision ?? 0}%
        </span>
        <span className="text-xs text-muted-foreground">{detailLevel ?? '—'}</span>
      </div>
      <Progress value={precision ?? 0} className={`h-1.5 ${precisionToneBar[tone]}`} />
    </div>
  );
}
