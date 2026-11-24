export type ClientType = "government" | "semi_gov" | "private";
export type ClientStatus = "active" | "inactive" | "archived";

export interface ClientContact {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  is_primary?: boolean;
}

export interface Client {
  id: string;
  code: string;
  name: string;
  type: ClientType;
  sector?: string | null;
  status: ClientStatus;
  contacts?: ClientContact[];
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type TenderStatus =
  | "registered"
  | "studying"
  | "review"
  | "submitted"
  | "won"
  | "lost"
  | "withdrawn";

export interface Tender {
  id: string;
  project_id: string;
  client_id?: string | null;
  client_name?: string | null;
  tender_no: string;
  title: string;
  package_name?: string | null;
  responsible_person?: string | null;
  status: TenderStatus;
  status_reason?: string | null;
  submission_deadline?: string | null;
  submission_time?: string | null;
  submitted_at?: string | null;
  submitted_amount?: number | null;
  currency?: string | null;
  estimated_value?: number | null;
  rfi_deadline?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TenderTransition {
  id: string;
  tender_id: string;
  from_status: TenderStatus;
  to_status: TenderStatus;
  reason?: string | null;
  changed_by?: string | null;
  created_at?: string;
}

export const CLIENT_TYPE_META: Record<ClientType, { label: string; cls: string }> = {
  government: { label: "حكومي", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  semi_gov: { label: "شبه حكومي", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  private: { label: "قطاع خاص", cls: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
};

export const CLIENT_STATUS_META: Record<ClientStatus, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  inactive: { label: "غير نشط", cls: "bg-muted/60 text-muted-foreground border-border/60" },
  archived: { label: "مؤرشف", cls: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
};

export const TENDER_STATUS_META: Record<TenderStatus, { label: string; cls: string; step: number }> = {
  registered: { label: "تسجيل الدعوة", cls: "bg-blue-500/15 text-blue-500 border-blue-500/30", step: 1 },
  studying: { label: "قيد الدراسة", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30", step: 2 },
  review: { label: "المراجعة والاعتماد", cls: "bg-purple-500/15 text-purple-500 border-purple-500/30", step: 3 },
  submitted: { label: "تم التقديم", cls: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30", step: 4 },
  won: { label: "فوز بالعطاء", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", step: 5 },
  lost: { label: "لم يحالفنا الحظ", cls: "bg-rose-500/15 text-rose-500 border-rose-500/30", step: 5 },
  withdrawn: { label: "اعتذار / ملغاة", cls: "bg-muted/60 text-muted-foreground border-border/60", step: 5 },
};
