import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { LanguageProvider, useLanguage } from "@/lib/i18n";

function NotFoundComponent() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          {t("notFound.title", "الصفحة غير موجودة")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("notFound.desc", "الرابط الذي تحاول الوصول إليه غير صحيح أو تم نقله.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("notFound.home", "العودة للرئيسية")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useLanguage();

  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("error.title", "تعذّر تحميل هذه الصفحة")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || t("error.desc", "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.")}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("error.retry", "إعادة المحاولة")}
          </button>
          <Link
            to="/"
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("notFound.home", "العودة للرئيسية")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "تقديري — منصة تسعير وإدارة المناقصات | Taqdiri Platform",
      },
      {
        name: "description",
        content: "منصة المقاولات الرائدة لتسعير وإدارة جداول الكميات والمناقصات ومكتبة أسعار الموارد بالمملكة العربية السعودية.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Inline script prevents hydration flash and establishes saved direction on initial paint
  const initThemeAndLangScript = `
    try {
      var savedLang = localStorage.getItem('taqdiri:language') || 'ar';
      document.documentElement.lang = savedLang;
      document.documentElement.dir = savedLang === 'en' ? 'ltr' : 'rtl';
    } catch (e) {}
  `;

  return (
    <html lang="ar" dir="rtl" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: initThemeAndLangScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function InnerApp() {
  const { direction } = useLanguage();
  return <Toaster richColors position="top-center" dir={direction} />;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <InnerApp />
      </QueryClientProvider>
    </LanguageProvider>
  );
}
