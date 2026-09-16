'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { login, signUp, confirmSignUp, resendConfirmationCode } from '@/lib/auth';
import {
  Compass,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

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

function EmailInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        type="email"
        autoComplete="username"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8"
      />
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
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [confirming, setConfirming] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      await login(loginEmail, loginPassword);
      router.replace('/');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegError(null);
    if (regPassword !== regPasswordConfirm) {
      setRegError('Las contraseñas no coinciden.');
      return;
    }
    setRegSubmitting(true);
    try {
      await signUp(regEmail, regPassword);
      setConfirming(true);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'No se pudo crear la cuenta.');
    } finally {
      setRegSubmitting(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setConfirmSubmitting(true);
    setConfirmError(null);
    try {
      await confirmSignUp(regEmail, code);
      setConfirming(false);
      setTab('login');
      setLoginEmail(regEmail);
      setLoginPassword('');
      setRegPassword('');
      setRegPasswordConfirm('');
      setCode('');
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'No se pudo confirmar el código.');
    } finally {
      setConfirmSubmitting(false);
    }
  }

  async function handleResend() {
    setResendNotice(null);
    setConfirmError(null);
    try {
      await resendConfirmationCode(regEmail);
      setResendNotice('Te reenviamos el código.');
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'No se pudo reenviar el código.');
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

          {confirming ? (
            <Card className="border-none shadow-none">
              <CardHeader className="px-0">
                <CardTitle>Confirmá tu cuenta</CardTitle>
                <CardDescription>
                  Te enviamos un código a <span className="font-medium text-foreground">{regEmail}</span>. Ingresalo
                  para activar tu cuenta.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <form onSubmit={handleConfirm} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="code">Código de verificación</Label>
                    <Input
                      id="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="123456"
                    />
                  </div>
                  {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
                  {resendNotice && <p className="text-sm text-brand">{resendNotice}</p>}
                  <Button
                    type="submit"
                    disabled={confirmSubmitting}
                    className="bg-brand text-brand-foreground hover:bg-brand-hover"
                  >
                    {confirmSubmitting && <Loader2 className="animate-spin" />}
                    Confirmar y continuar
                  </Button>
                  <button
                    type="button"
                    onClick={handleResend}
                    className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Reenviar código
                  </button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'register')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Iniciar sesión</TabsTrigger>
                <TabsTrigger value="register">Crear cuenta</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="pt-6">
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-email">Correo</Label>
                    <EmailInput id="login-email" value={loginEmail} onChange={setLoginEmail} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-password">Contraseña</Label>
                    <PasswordInput
                      id="login-password"
                      value={loginPassword}
                      onChange={setLoginPassword}
                      autoComplete="current-password"
                    />
                  </div>
                  {loginError && <p className="text-sm text-destructive">{loginError}</p>}
                  <Button
                    type="submit"
                    disabled={loginSubmitting}
                    className="bg-brand text-brand-foreground hover:bg-brand-hover"
                  >
                    {loginSubmitting && <Loader2 className="animate-spin" />}
                    Entrar
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register" className="pt-6">
                <form onSubmit={handleRegister} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-email">Correo</Label>
                    <EmailInput id="reg-email" value={regEmail} onChange={setRegEmail} />
                    <p className="text-xs text-muted-foreground">Solo se aceptan correos @cnid.co.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-password">Contraseña</Label>
                    <PasswordInput
                      id="reg-password"
                      value={regPassword}
                      onChange={setRegPassword}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      Mínimo 8 caracteres, con mayúscula, minúscula y número.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-password-confirm">Confirmar contraseña</Label>
                    <PasswordInput
                      id="reg-password-confirm"
                      value={regPasswordConfirm}
                      onChange={setRegPasswordConfirm}
                      autoComplete="new-password"
                    />
                  </div>
                  {regError && <p className="text-sm text-destructive">{regError}</p>}
                  <Button
                    type="submit"
                    disabled={regSubmitting}
                    className="bg-brand text-brand-foreground hover:bg-brand-hover"
                  >
                    {regSubmitting && <Loader2 className="animate-spin" />}
                    Crear cuenta
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
