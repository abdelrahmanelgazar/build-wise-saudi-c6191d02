import type { Database } from "@/integrations/supabase/types";
import type { TranslationKey } from "@/lib/i18n/locales/ar";

export type ProjectStatus = Database["public"]["Enums"]["project_status"];

export interface StatusConfig {
  key: ProjectStatus;
  translationKey: TranslationKey;
  color: string;
  badgeClass: string;
}

export const STATUS_CONFIGS: Record<ProjectStatus, StatusConfig> = {
  studying: {
    key: "studying",
    translationKey: "status.studying",
    color: "#94a3b8",
    badgeClass: "bg-muted/60 text-muted-foreground border-border/60",
  },
  submitted_to_medial_man: {
    key: "submitted_to_medial_man",
    translationKey: "status.submitted_to_medial_man",
    color: "#f59e0b",
    badgeClass: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  },
  submitted_to_client: {
    key: "submitted_to_client",
    translationKey: "status.submitted_to_client",
    color: "#3b82f6",
    badgeClass: "bg-primary/15 text-primary border-primary/30",
  },
  waiting_for_reply: {
    key: "waiting_for_reply",
    translationKey: "status.waiting_for_reply",
    color: "#eab308",
    badgeClass: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  },
  inquiries_sent: {
    key: "inquiries_sent",
    translationKey: "status.inquiries_sent",
    color: "#06b6d4",
    badgeClass: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30",
  },
  answers_received: {
    key: "answers_received",
    translationKey: "status.answers_received",
    color: "#6366f1",
    badgeClass: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  },
  on_hold: {
    key: "on_hold",
    translationKey: "status.on_hold",
    color: "#f97316",
    badgeClass: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  },
  client_rejected: {
    key: "client_rejected",
    translationKey: "status.client_rejected",
    color: "#ef4444",
    badgeClass: "bg-red-500/15 text-red-500 border-red-500/30",
  },
  construction_ongoing: {
    key: "construction_ongoing",
    translationKey: "status.construction_ongoing",
    color: "#10b981",
    badgeClass: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  },
  construction_complete: {
    key: "construction_complete",
    translationKey: "status.construction_complete",
    color: "#14b8a6",
    badgeClass: "bg-teal-500/15 text-teal-500 border-teal-500/30",
  },
  finished: {
    key: "finished",
    translationKey: "status.finished",
    color: "#0ea5e9",
    badgeClass: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  },
  closed: {
    key: "closed",
    translationKey: "status.closed",
    color: "#64748b",
    badgeClass: "bg-muted/60 text-muted-foreground border-border/60",
  },
};

export const ALL_STATUSES: ProjectStatus[] = Object.keys(STATUS_CONFIGS) as ProjectStatus[];
