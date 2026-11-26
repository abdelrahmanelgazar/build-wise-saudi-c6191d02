import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, ChevronLeft, ChevronRight, FileText, FolderKanban, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { estimationClient } from "@/lib/estimation-client";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface HierarchySelection {
  companyName: string | null;
  ownerName: string | null;
  projectId: string | null;
  projectName: string | null;
  tenderId: string | null;
  tenderTitle: string | null;
}

/**
 * Shared Company -> Owner -> Project -> Tender hierarchical navigator (M-03 / M-05 / V3.0 §6.1).
 */
export function ProjectHierarchyTree({
  selected,
  onSelect,
}: {
  selected: HierarchySelection;
  onSelect: (next: HierarchySelection) => void;
}) {
  const { direction } = useLanguage();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: projects = [] } = useQuery({
    queryKey: ["hierarchy_projects"],
    queryFn: async () => {
      const { data } = await estimationClient
        .from("projects")
        .select("id, name, company_name, client_id, client_name")
        .order("created_at", { ascending: false });
      return (data as Array<Record<string, any>>) ?? [];
    },
  });

  const { data: tenders = [] } = useQuery({
    queryKey: ["hierarchy_tenders"],
    queryFn: async () => {
      const { data } = await estimationClient
        .from("tenders")
        .select("id, project_id, tender_no, title, status");
      return (data as Array<Record<string, any>>) ?? [];
    },
  });

  const tree = useMemo(() => {
    const companies = new Map<
      string,
      Map<string, Array<{ id: string; name: string; tenders: Array<{ id: string; title: string; tenderNo: string }> }>>
    >();

    const tendersByProject = new Map<string, Array<{ id: string; title: string; tenderNo: string }>>();
    for (const t of tenders) {
      const pid = String(t["project_id"] ?? "");
      if (!pid) continue;
      const list = tendersByProject.get(pid) ?? [];
      list.push({
        id: String(t["id"]),
        title: String(t["title"] ?? t["tender_no"] ?? "منافسة"),
        tenderNo: String(t["tender_no"] ?? ""),
      });
      tendersByProject.set(pid, list);
    }

    for (const p of projects) {
      const comp = String(p["company_name"] ?? "").trim() || "الشركة الرئيسية";
      const owner = String(p["client_name"] ?? "").trim() || "مالك غير محدد";
      if (!companies.has(comp)) companies.set(comp, new Map());
      const owners = companies.get(comp)!;
      if (!owners.has(owner)) owners.set(owner, []);
      const pid = String(p["id"]);
      owners.get(owner)!.push({
        id: pid,
        name: String(p["name"] ?? "مشروع"),
        tenders: tendersByProject.get(pid) ?? [],
      });
    }

    return Array.from(companies.entries()).map(([companyName, ownersMap]) => ({
      companyName,
      owners: Array.from(ownersMap.entries()).map(([ownerName, projList]) => ({
        ownerName,
        projects: projList,
      })),
    }));
  }, [projects, tenders]);

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
        <span className="font-bold text-foreground flex items-center gap-1.5">
          <FolderKanban className="h-3.5 w-3.5 text-primary" />
          شجرة التصفية: الشركة ← المالك ← المشروع ← المنافسة
        </span>
        {(selected.companyName || selected.projectId || selected.tenderId) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[10px]"
            onClick={() =>
              onSelect({
                companyName: null,
                ownerName: null,
                projectId: null,
                projectName: null,
                tenderId: null,
                tenderTitle: null,
              })
            }
          >
            إظهار كل المشاريع
          </Button>
        )}
      </div>

      {tree.length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-2">لا توجد مشاريع مسجلة في الشجرة بعد.</div>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {tree.map((comp) => {
            const cKey = `c:${comp.companyName}`;
            const cOpen = Boolean(expanded[cKey] ?? true);
            return (
              <div key={cKey} className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggle(cKey)}
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="توسيع الشركة"
                  >
                    {cOpen ? <ChevronDown className="h-3.5 w-3.5" /> : direction === "rtl" ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSelect({
                        companyName: comp.companyName,
                        ownerName: null,
                        projectId: null,
                        projectName: null,
                        tenderId: null,
                        tenderTitle: null,
                      })
                    }
                    className={cn(
                      "flex items-center gap-1.5 rounded px-1.5 py-0.5 font-semibold hover:bg-accent",
                      selected.companyName === comp.companyName && !selected.ownerName && "bg-primary/15 text-primary",
                    )}
                  >
                    <Building2 className="h-3 w-3" />
                    <span>{comp.companyName}</span>
                  </button>
                </div>

                {cOpen && (
                  <div className="ms-4 border-s border-border/60 ps-2 space-y-0.5">
                    {comp.owners.map((owner) => (
                      <div key={owner.ownerName} className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            onSelect({
                              companyName: comp.companyName,
                              ownerName: owner.ownerName,
                              projectId: null,
                              projectName: null,
                              tenderId: null,
                              tenderTitle: null,
                            })
                          }
                          className={cn(
                            "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent",
                            selected.ownerName === owner.ownerName && !selected.projectId && "bg-primary/15 text-primary font-medium",
                          )}
                        >
                          <Users className="h-3 w-3 text-muted-foreground" />
                          <span>{owner.ownerName}</span>
                        </button>

                        <div className="ms-4 border-s border-border/50 ps-2 space-y-0.5">
                          {owner.projects.map((proj) => (
                            <div key={proj.id} className="space-y-0.5">
                              <button
                                type="button"
                                onClick={() =>
                                  onSelect({
                                    companyName: comp.companyName,
                                    ownerName: owner.ownerName,
                                    projectId: proj.id,
                                    projectName: proj.name,
                                    tenderId: null,
                                    tenderTitle: null,
                                  })
                                }
                                className={cn(
                                  "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent",
                                  selected.projectId === proj.id && !selected.tenderId && "bg-primary/15 text-primary font-semibold",
                                )}
                              >
                                <FileText className="h-3 w-3 text-primary" />
                                <span>{proj.name}</span>
                              </button>

                              {proj.tenders.length > 0 && (
                                <div className="ms-4 flex flex-wrap gap-1 pt-0.5">
                                  {proj.tenders.map((tnd) => (
                                    <button
                                      key={tnd.id}
                                      type="button"
                                      onClick={() =>
                                        onSelect({
                                          companyName: comp.companyName,
                                          ownerName: owner.ownerName,
                                          projectId: proj.id,
                                          projectName: proj.name,
                                          tenderId: tnd.id,
                                          tenderTitle: tnd.title,
                                        })
                                      }
                                      className="text-[10px]"
                                    >
                                      <Badge variant={selected.tenderId === tnd.id ? "default" : "outline"} className="text-[10px] cursor-pointer">
                                        {tnd.tenderNo || tnd.title}
                                      </Badge>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
