import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Building2 } from "lucide-react";
import { fetchClientsWithStats } from "@/lib/client-tender-service";
import { CompaniesManager } from "@/components/clients/companies-manager";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";

const companiesSearchSchema = z.object({
  company: z.string().optional(),
  new: z.union([z.string(), z.number()]).optional(),
  edit: z.union([z.string(), z.number()]).optional(),
});

export const Route = createFileRoute("/_authenticated/companies")({
  head: () => ({
    meta: [
      { title: "إدارة الشركات — تقديري" },
      { name: "description", content: "إدارة الشركات الجهات الدارسة وربط الملاك والمشاريع." },
    ],
  }),
  validateSearch: companiesSearchSchema,
  component: CompaniesPage,
});

function CompaniesPage() {
  const navigate = useNavigate();
  const { company, new: isNew, edit: isEdit } = Route.useSearch();

  useRegisterPageActions({
    pageKey: "companies",
    hasEditableState: true,
    queryKeys: [["companies"], ["clients"], ["projects"]],
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClientsWithStats,
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
          <Building2 className="h-7 w-7 text-primary" />
          <span>الشركات (الجهات الدارسة)</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          إدارة الشركات التي تدرس المنصة المشاريع لصالحها، وربط الملاك والمشاريع التابعة لكل شركة.
        </p>
      </div>

      <CompaniesManager
        clients={clients}
        {...(company ? { selectedCompanyName: company } : {})}
        openNewCompany={Boolean(isNew)}
        openEditForSelected={Boolean(isEdit)}
        onClearCompanyFilter={() => void navigate({ to: "/companies" })}
      />
    </div>
  );
}
