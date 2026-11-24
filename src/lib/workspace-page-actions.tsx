import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

export interface PageActionConfig {
  pageKey: string;
  hasEditableState?: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  queryKeys?: QueryKey[];
  onSave?: () => Promise<void> | void;
  onDiscard?: () => void;
}

interface WorkspaceActionsContextValue {
  config: PageActionConfig | null;
  lastSavedAt: Date | null;
  isRefreshing: boolean;
  isSaving: boolean;
  pendingDirtyPrompt: {
    actionLabel: string;
    onProceed: () => void;
  } | null;
  registerPageActions: (cfg: PageActionConfig) => () => void;
  triggerSave: () => Promise<boolean>;
  triggerRefresh: () => Promise<void>;
  guardNavigation: (actionLabel: string, proceed: () => void) => void;
  resolveDirtyPrompt: (choice: "save_and_proceed" | "discard" | "cancel") => Promise<void>;
}

const WorkspaceActionsContext = createContext<WorkspaceActionsContextValue | null>(null);

export function WorkspaceActionsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [config, setConfig] = useState<PageActionConfig | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingLocal, setIsSavingLocal] = useState(false);
  const [pendingDirtyPrompt, setPendingDirtyPrompt] = useState<{
    actionLabel: string;
    onProceed: () => void;
  } | null>(null);

  const configRef = useRef<PageActionConfig | null>(null);
  configRef.current = config;

  const registerPageActions = useCallback((cfg: PageActionConfig) => {
    setConfig(cfg);
    return () => {
      setConfig((prev) => (prev?.pageKey === cfg.pageKey ? null : prev));
    };
  }, []);

  const performRefresh = useCallback(async () => {
    const cur = configRef.current;
    setIsRefreshing(true);
    try {
      if (cur?.queryKeys && cur.queryKeys.length > 0) {
        await Promise.all(cur.queryKeys.map((qk) => qc.invalidateQueries({ queryKey: qk })));
      } else {
        await qc.invalidateQueries();
      }
      toast.success("تم تحديث البيانات بنجاح");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "تعذر تحديث البيانات";
      toast.error(msg);
    } finally {
      setIsRefreshing(false);
    }
  }, [qc]);

  const triggerSave = useCallback(async (): Promise<boolean> => {
    const cur = configRef.current;
    // Blur active editable cell/input so onBlur commit handlers run before save
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      const tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable) {
        document.activeElement.blur();
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    setIsSavingLocal(true);
    try {
      if (cur?.onSave) {
        await cur.onSave();
      }
      setLastSavedAt(new Date());
      toast.success("تم الحفظ بنجاح");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "تعذر الحفظ — بقيت التعديلات محلياً";
      toast.error(msg);
      return false;
    } finally {
      setIsSavingLocal(false);
    }
  }, []);

  const triggerRefresh = useCallback(async () => {
    const cur = configRef.current;
    if (cur?.isDirty) {
      setPendingDirtyPrompt({
        actionLabel: "تحديث البيانات",
        onProceed: () => {
          void performRefresh();
        },
      });
      return;
    }
    await performRefresh();
  }, [performRefresh]);

  const guardNavigation = useCallback((actionLabel: string, proceed: () => void) => {
    const cur = configRef.current;
    if (cur?.isDirty) {
      setPendingDirtyPrompt({
        actionLabel,
        onProceed: proceed,
      });
      return;
    }
    proceed();
  }, []);

  const resolveDirtyPrompt = useCallback(
    async (choice: "save_and_proceed" | "discard" | "cancel") => {
      const prompt = pendingDirtyPrompt;
      if (!prompt) return;
      if (choice === "cancel") {
        setPendingDirtyPrompt(null);
        return;
      }
      if (choice === "save_and_proceed") {
        const ok = await triggerSave();
        if (!ok) return;
      } else if (choice === "discard") {
        configRef.current?.onDiscard?.();
      }
      setPendingDirtyPrompt(null);
      prompt.onProceed();
    },
    [pendingDirtyPrompt, triggerSave],
  );

  return (
    <WorkspaceActionsContext.Provider
      value={{
        config,
        lastSavedAt,
        isRefreshing,
        isSaving: isSavingLocal || Boolean(config?.isSaving),
        pendingDirtyPrompt,
        registerPageActions,
        triggerSave,
        triggerRefresh,
        guardNavigation,
        resolveDirtyPrompt,
      }}
    >
      {children}
    </WorkspaceActionsContext.Provider>
  );
}

export function useWorkspaceActions() {
  return useContext(WorkspaceActionsContext);
}

export function useRegisterPageActions(cfg: PageActionConfig) {
  const ctx = useWorkspaceActions();
  const register = ctx?.registerPageActions;
  const latestRef = useRef(cfg);
  latestRef.current = cfg;

  useEffect(() => {
    if (!register) return;
    return register({
      ...cfg,
      ...(cfg.onSave ? { onSave: () => latestRef.current.onSave?.() } : {}),
      ...(cfg.onDiscard ? { onDiscard: () => latestRef.current.onDiscard?.() } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, cfg.pageKey, cfg.hasEditableState, cfg.isDirty, cfg.isSaving]);
}
