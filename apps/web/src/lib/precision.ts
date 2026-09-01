export function precisionTone(precision: number | undefined): 'good' | 'medium' | 'low' {
  if (precision === undefined) return 'low';
  if (precision >= 70) return 'good';
  if (precision >= 40) return 'medium';
  return 'low';
}

export const precisionToneClasses: Record<'good' | 'medium' | 'low', string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-red-600 dark:text-red-400',
};

export const precisionToneBar: Record<'good' | 'medium' | 'low', string> = {
  good: '[&>div]:bg-emerald-500',
  medium: '[&>div]:bg-amber-500',
  low: '[&>div]:bg-red-500',
};
