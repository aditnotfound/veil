import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PluelyApiSetup, Usage } from "./components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import { seedVeilDefaultPrompts } from "@/lib/database";

const Dashboard = () => {
  const { hasActiveLicense } = useApp();
  const [activity, setActivity] = useState<any>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const seedStarted = useRef(false);

  const fetchActivity = useCallback(async () => {
    if (!hasActiveLicense) {
      setActivity({ data: [], total_tokens_used: 0 });
      return;
    }
    setLoadingActivity(true);
    try {
      const response = await invoke("get_activity");
      const responseData: any = response;
      if (responseData && responseData.success) {
        setActivity(responseData);
      } else {
        setActivity({ data: [], total_tokens_used: 0 });
      }
    } catch (error) {
      setActivity({ data: [], total_tokens_used: 0 });
    } finally {
      setLoadingActivity(false);
    }
  }, [hasActiveLicense]);

  useEffect(() => {
    if (seedStarted.current) return;
    seedStarted.current = true;
    seedVeilDefaultPrompts().catch((err) => {
      console.error("Failed to seed Veil default prompts:", err);
    });
  }, []);

  useEffect(() => {
    if (hasActiveLicense) {
      fetchActivity();
    } else {
      setActivity(null);
    }
  }, [fetchActivity, hasActiveLicense]);

  const activityData =
    activity && Array.isArray(activity.data) ? activity.data : [];
  const totalTokens =
    activity && typeof activity.total_tokens_used === "number"
      ? activity.total_tokens_used
      : 0;

  return (
    <PageLayout
      title="Dashboard"
      description="Bring your own API keys, manage providers, and see local usage."
    >
      <PluelyApiSetup />

      <Usage
        loading={loadingActivity}
        onRefresh={fetchActivity}
        data={activityData}
        totalTokens={totalTokens}
      />
    </PageLayout>
  );
};

export default Dashboard;
