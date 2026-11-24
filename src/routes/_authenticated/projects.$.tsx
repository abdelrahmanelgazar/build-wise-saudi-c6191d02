import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { estimationClient } from "@/lib/estimation-client";
import { setActiveProjectId } from "@/lib/active-project";

export const Route = createFileRoute("/_authenticated/projects/$")({
  beforeLoad: async ({ params }) => {
    const splat = (params as Record<string, string>)["_splat"];
    if (splat) {
      const normalized7 = splat.replace(/\//g, "7");
      const stripped = splat.replace(/\//g, "");

      const { data: projects } = await estimationClient.from("projects").select("id");
      const list = (projects as { id: string }[] | null) ?? [];
      const matched = list.find(
        (p) =>
          p.id === splat ||
          p.id === normalized7 ||
          p.id === stripped ||
          normalized7.includes(p.id) ||
          p.id.includes(normalized7),
      );
      if (matched) {
        setActiveProjectId(matched.id);
        throw redirect({
          to: "/projects/$projectId",
          params: { projectId: matched.id },
        });
      }
    }
    throw redirect({ to: "/projects" });
  },
  component: ProjectSplatFallback,
  errorComponent: ProjectSplatErrorFallback,
});

function ProjectSplatFallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Client-side fallback redirect
    const path = window.location.pathname;
    const match = path.match(/\/projects\/(.+)$/);
    if (match?.[1]) {
      const normalized = match[1].replace(/\//g, "7");
      estimationClient
        .from("projects")
        .select("id")
        .then(({ data }) => {
          const list = (data as { id: string }[] | null) ?? [];
          const found = list.find((p) => p.id === normalized || normalized.includes(p.id));
          if (found) {
            setActiveProjectId(found.id);
            window.location.replace(`/projects/${found.id}`);
            return;
          }
          navigate({ to: "/projects" });
        });
    } else {
      navigate({ to: "/projects" });
    }
  }, [navigate]);

  return (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      جاري التوجيه إلى المشروع…
    </div>
  );
}

function ProjectSplatErrorFallback() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.replace("/projects");
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <div>جاري العودة لقائمة المشاريع…</div>
      <a href="/projects" className="text-primary underline text-xs">
        اضغط هنا إذا لم يتم التحويل تلقائياً
      </a>
    </div>
  );
}
