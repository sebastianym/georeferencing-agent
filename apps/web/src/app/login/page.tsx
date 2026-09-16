'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { login, completeNewPassword } from '@/lib/auth';
import { Compass, Eye, EyeOff, Loader2, Lock, Mail, MapPin, ShieldCheck, Sparkles } from 'lucide-react';

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-8 pl-8"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

const PILLARS = [
  { icon: Sparkles, label: 'Optimización con IA de extremo a extremo' },
  { icon: MapPin, label: 'Precisión medible, antes y después' },
  { icon: ShieldCheck, label: 'Acceso protegido por cuenta' },
];

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set only when login() reports a NEW_PASSWORD_REQUIRED challenge — an
  // admin-created account logging in for the first time.
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newPasswordSubmitting, setNewPasswordSubmitting] = useState(false);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(email, password);
      if (!result.ok) {
        setPendingSession(result.session);
        return;
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNewPassword(e: FormEvent) {
    e.preventDefault();
    setNewPasswordError(null);
    if (newPassword !== newPasswordConfirm) {
      setNewPasswordError('Las contraseñas no coinciden.');
      return;
    }
    if (!pendingSession) return;
    setNewPasswordSubmitting(true);
    try {
      await completeNewPassword(email, newPassword, pendingSession);
      router.replace('/');
    } catch (err) {
      setNewPasswordError(err instanceof Error ? err.message : 'No se pudo definir la contraseña.');
    } finally {
      setNewPasswordSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-4xl overflow-hidden rounded-2xl border shadow-sm">
        {/* Decorative brand panel — hidden below lg, purely visual */}
        <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-linear-to-br from-brand to-emerald-800 p-8 text-brand-foreground lg:flex">
          <div className="absolute -top-16 -right-16 size-56 rounded-full bg-white/10" />
          <div className="absolute -bottom-20 -left-10 size-64 rounded-full bg-white/5" />
          <span className="relative flex size-10 items-center justify-center rounded-md bg-white/15">
            <Compass className="size-5" />
          </span>
          <div className="relative flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Agente de Georeferenciación</h2>
              <p className="mt-2 text-sm text-brand-foreground/80">
                Validá, optimizá y compará la precisión de direcciones colombianas con IA.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {PILLARS.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2.5 text-sm text-brand-foreground/90">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/15">
                    <Icon className="size-3.5" />
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Form panel */}
        <div className="flex w-full flex-col justify-center bg-background p-6 sm:p-10 lg:w-[54%]">
          <div className="mb-6 flex items-center gap-2 font-semibold tracking-tight lg:hidden">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
              <Compass className="size-4" />
            </span>
            Agente de Georeferenciación
          </div>

          {pendingSession ? (
            <Card className="border-none shadow-none">
              <CardHeader className="px-0">
                <CardTitle>Definí tu contraseña</CardTitle>
                <CardDescription>
                  Es tu primer ingreso. Elegí una contraseña propia para <span className="font-medium text-foreground">{email}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <form onSubmit={handleNewPassword} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="new-password">Contraseña nueva</Label>
                    <PasswordInput
                      id="new-password"
                      value={newPassword}
                      onChange={setNewPassword}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      Mínimo 8 caracteres, con mayúscula, minúscula y número.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="new-password-confirm">Confirmar contraseña</Label>
                    <PasswordInput
                      id="new-password-confirm"
                      value={newPasswordConfirm}
                      onChange={setNewPasswordConfirm}
                      autoComplete="new-password"
                    />
                  </div>
                  {newPasswordError && <p className="text-sm text-destructive">{newPasswordError}</p>}
                  <Button
                    type="submit"
                    disabled={newPasswordSubmitting}
                    className="bg-brand text-brand-foreground hover:bg-brand-hover"
                  >
                    {newPasswordSubmitting && <Loader2 className="animate-spin" />}
                    Guardar y entrar
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-none shadow-none">
              <CardHeader className="px-0">
                <CardTitle>Iniciar sesión</CardTitle>
                <CardDescription>Ingresá tus credenciales para acceder al agente de georeferenciación.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">Correo</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password">Contraseña</Label>
                    <PasswordInput
                      id="password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="current-password"
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-brand text-brand-foreground hover:bg-brand-hover"
                  >
                    {submitting && <Loader2 className="animate-spin" />}
                    Entrar
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    ¿No tenés cuenta? Pedile a un administrador que te la cree.
                  </p>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
