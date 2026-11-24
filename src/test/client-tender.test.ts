import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkDuplicateClientName,
  archiveClient,
  mergeClients,
  transitionTenderStatus,
} from "@/lib/client-tender-service";
import { estimationClient } from "@/lib/estimation-client";

describe("Client and Tender Service (In-Memory Mock Verification)", () => {
  let mockStore: {
    clients: any[];
    projects: any[];
    tenders: any[];
    tender_transitions: any[];
  };

  beforeEach(() => {
    mockStore = {
      clients: [
        {
          id: "c-1",
          name: "وزارة الصحة – الديوان العام",
          code: "MOH-SA",
          status: "active",
          type: "government",
        },
      ],
      projects: [
        {
          id: "p-1",
          name: "مشروع مستشفى فيفا",
          client_id: "c-1",
          client_name: "وزارة الصحة – الديوان العام",
        },
      ],
      tenders: [
        {
          id: "t-1",
          project_id: "p-1",
          client_id: "c-1",
          title: "عطاء المستشفى",
          status: "registered",
        },
      ],
      tender_transitions: [],
    };

    vi.spyOn(estimationClient, "from").mockImplementation((table: string) => {
      const records = mockStore[table as keyof typeof mockStore] || [];

      return {
        select: (_cols?: string) => {
          let current = [...records];
          const queryObj = {
            eq: (col: string, val: any) => {
              current = current.filter((r) => r[col] === val);
              return queryObj;
            },
            single: async () => ({ data: current[0] || null, error: null }),
            maybeSingle: async () => ({ data: current[0] || null, error: null }),
            then: (resolve: any) => resolve({ data: current, error: null }),
          };
          return queryObj;
        },
        insert: (vals: any) => {
          const list = Array.isArray(vals) ? vals : [vals];
          const inserted = list.map((v) => {
            const row = { id: v.id || `id-${Date.now()}-${Math.random()}`, ...v };
            records.push(row);
            return row;
          });
          const resObj = {
            select: () => ({
              single: async () => ({ data: inserted[0], error: null }),
              then: (resolve: any) => resolve({ data: inserted, error: null }),
            }),
            then: (resolve: any) => resolve({ data: inserted, error: null }),
          };
          return resObj;
        },
        update: (updates: any) => {
          let targetId: string | null = null;
          return {
            eq: (col: string, val: any) => {
              if (col === "id") targetId = val;
              records.forEach((r) => {
                if (r[col] === val) Object.assign(r, updates);
              });
              return {
                then: (resolve: any) => resolve({ error: null }),
              };
            },
          };
        },
        delete: () => ({
          eq: (col: string, val: any) => {
            const idx = records.findIndex((r) => r[col] === val);
            if (idx >= 0) records.splice(idx, 1);
            return {
              then: (resolve: any) => resolve({ error: null }),
            };
          },
        }),
      } as any;
    });
  });

  it("detects duplicate client names correctly", async () => {
    // Exact duplicate
    const isDup1 = await checkDuplicateClientName("وزارة الصحة – الديوان العام");
    expect(isDup1).toBe(true);

    // Duplicate with whitespace / tatweel
    const isDup2 = await checkDuplicateClientName("  وزارة الصحة – الديوان العام  ");
    expect(isDup2).toBe(true);

    // Non-duplicate name
    const isDup3 = await checkDuplicateClientName("شركة البحر الأحمر للتطوير");
    expect(isDup3).toBe(false);
  });

  it("archives client properly without hard deletion", async () => {
    await archiveClient("c-1");
    const archived = mockStore.clients.find((c) => c.id === "c-1");
    expect(archived?.status).toBe("archived");
  });

  it("merges source client into target client, transferring projects and tenders", async () => {
    // Add second client
    mockStore.clients.push({
      id: "c-2",
      name: "وزارة الصحة (مكرر)",
      code: "MOH-DUP",
      status: "active",
    });
    mockStore.projects.push({
      id: "p-2",
      name: "مشروع مركز صحي",
      client_id: "c-2",
      client_name: "وزارة الصحة (مكرر)",
    });
    mockStore.tenders.push({
      id: "t-2",
      project_id: "p-2",
      client_id: "c-2",
      title: "منافسة المركز",
      status: "studying",
    });

    await mergeClients("c-2", "c-1", "دمج العميل المكرر مع الحساب الأساسي");

    // Source client should be archived
    const sourceClient = mockStore.clients.find((c) => c.id === "c-2");
    expect(sourceClient?.status).toBe("archived");
    expect(sourceClient?.notes).toContain("تم دمج هذا العميل في");

    // Project p-2 should now point to target c-1
    const mergedProject = mockStore.projects.find((p) => p.id === "p-2");
    expect(mergedProject?.client_id).toBe("c-1");

    // Tender t-2 should now point to target c-1
    const mergedTender = mockStore.tenders.find((t) => t.id === "t-2");
    expect(mergedTender?.client_id).toBe("c-1");
  });

  it("transitions tender status and records decision reason in tender_transitions", async () => {
    await transitionTenderStatus(
      "t-1",
      "registered",
      "submitted",
      "تم تقديم الضمان البنكي والعرض الفني بنجاح",
      "user-001",
    );

    const updatedTender = mockStore.tenders.find((t) => t.id === "t-1");
    expect(updatedTender?.status).toBe("submitted");

    expect(mockStore.tender_transitions.length).toBe(1);
    const log = mockStore.tender_transitions[0];
    expect(log.tender_id).toBe("t-1");
    expect(log.from_status).toBe("registered");
    expect(log.to_status).toBe("submitted");
    expect(log.reason).toBe("تم تقديم الضمان البنكي والعرض الفني بنجاح");
    expect(log.changed_by).toBe("user-001");
  });
});
