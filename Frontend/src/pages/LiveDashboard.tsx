import { FootfallChart } from '@/components/charts/FootfallChart';
import { LiveActivity } from '@/components/events/LiveActivity';
import { RecentEvents } from '@/components/events/RecentEvents';
import { CameraHealth } from '@/components/health/CameraHealth';
import { SystemHealth } from '@/components/health/SystemHealth';
import { KpiRow } from '@/components/kpi/KpiRow';
import { LiveCamera } from '@/components/live/LiveCamera';
import { useLineShortcuts } from '@/hooks/useLineEditor';

/**
 * Live Operations: camera + trend on the left, numbers and health on the right,
 * recent snapshots underneath. Columns flow independently so neither leaves gaps.
 */
export default function LiveDashboard() {
  useLineShortcuts(true);
  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8 lg:gap-5">
          <LiveCamera />
          <FootfallChart />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-4">
          <KpiRow />
          <CameraHealth />
          <SystemHealth />
          <LiveActivity />
        </div>
      </div>
      <RecentEvents />
    </div>
  );
}
