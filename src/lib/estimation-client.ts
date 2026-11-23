import { supabase } from "@/integrations/supabase/client";
import { isLocalDevelopment } from "./local-development";
import { localEstimationStore } from "./local-estimation-store";

// Estimation screens use this subset of the generated client's API.
type EstimationClient = Pick<typeof supabase, "from" | "storage"> & {
  auth: Pick<typeof supabase.auth, "getUser">;
};

export const estimationClient: EstimationClient = isLocalDevelopment()
  ? (localEstimationStore as unknown as EstimationClient)
  : supabase;
