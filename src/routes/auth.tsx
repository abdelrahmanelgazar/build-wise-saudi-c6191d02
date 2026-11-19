import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/ui/language-switcher";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "تسجيل الدخول — تقديري | Taqdiri Sign In" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/boq", replace: true });
    });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error(t("auth.errorFill", "يرجى تعبئة البريد الإلكتروني وكلمة المرور"));
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success(t("auth.accountCreated", "تم إنشاء الحساب! يمكنك الآن تسجيل الدخول."));
        // attempt auto sign-in
        await supabase.auth.signInWithPassword({ email, password });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      // seed demo data on first login (no-op if already seeded)
      try { await supabase.rpc("seed_demo_data" as never); } catch { /* idempotent */ }
      navigate({ to: "/boq", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("auth.errorOccurred", "حدث خطأ");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message || t("auth.googleError", "تعذر تسجيل الدخول بـ Google"));
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      try { await supabase.rpc("seed_demo_data" as never); } catch { /* idempotent */ }
      navigate({ to: "/boq", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("auth.errorOccurred", "خطأ غير متوقع");
      toast.error(msg);
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-6">
      {/* Language Switcher in top corner */}
      <div className="absolute top-6 end-6 z-10">
        <LanguageSwitcher variant="outline" className="shadow-sm border-border/80" />
      </div>

      {/* ambient gradient */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-chart-2/10 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Calculator className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t("auth.brandTitle", "تقديري")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.brandSubtitle", "منصة تسعير المقاولات وإدارة المناقصات")}
          </p>
        </div>

        <Card className="border-border/60 p-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t("auth.signInTab", "تسجيل الدخول")}</TabsTrigger>
              <TabsTrigger value="signup">{t("auth.signUpTab", "إنشاء حساب")}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-5">
              <form onSubmit={handleEmail} className="space-y-4">
                <FormFields
                  email={email}
                  password={password}
                  setEmail={setEmail}
                  setPassword={setPassword}
                />
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.signInButton", "تسجيل الدخول")}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-5">
              <form onSubmit={handleEmail} className="space-y-4">
                <FormFields
                  email={email}
                  password={password}
                  setEmail={setEmail}
                  setPassword={setPassword}
                />
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.signUpButton", "إنشاء حساب")}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{t("auth.or", "أو")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={handleGoogle}
            className="w-full gap-2"
          >
            <GoogleIcon />
            {t("auth.googleSignIn", "متابعة باستخدام Google")}
          </Button>
        </Card>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          {t("auth.footerNote", "مُصمَّم لشركات المقاولات في المملكة العربية السعودية")}
        </p>
      </div>
    </div>
  );
}

function FormFields({
  email,
  password,
  setEmail,
  setPassword,
}: {
  email: string;
  password: string;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("auth.emailLabel", "البريد الإلكتروني")}</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.emailPlaceholder", "name@company.com")}
          dir="ltr"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("auth.passwordLabel", "كلمة المرور")}</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          dir="ltr"
          required
          minLength={6}
        />
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.83z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
        fill="#EA4335"
      />
    </svg>
  );
}
