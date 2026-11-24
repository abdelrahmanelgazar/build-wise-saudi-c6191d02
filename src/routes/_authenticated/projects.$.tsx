import { createFileRoute, redirect } from "@tanstack/react-router";
import { estimationClient } from "@/lib/estimation-client";
import { setActiveProjectId } from "@/lib/active-project";

export const Route = createFileRoute("/_authenticated/projects/$")({
  beforeLoad: async ({ params }) => {
    const splat = (params as Record<string, string>)["_splat"];
    if (splat) {
      // If slashes were accidentally typed or substituted in UUID (e.g. 1/ce5bb5-4cf8-44ac-9a12-941/064f81c4)
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
          p.id.includes(normalized7)
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
  component: () => null,
});
