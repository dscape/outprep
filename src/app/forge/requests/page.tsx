import { getFeatureRequests } from "@/lib/forge";
import { FeatureRequestCard } from "@/components/forge/FeatureRequestCard";

export const dynamic = "force-dynamic";

export default function RequestsPage() {
  const requests = getFeatureRequests();
  const openCount = requests.filter((r) => r.status === "open").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Feature Requests</h2>
        <p className="text-sm text-zinc-500">
          {requests.length} request{requests.length !== 1 ? "s" : ""} &middot;{" "}
          {openCount} open
        </p>
      </div>

      {requests.length > 0 ? (
        <div className="space-y-4">
          {requests.map((req) => (
            <FeatureRequestCard key={req.id} request={req} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            No feature requests yet. Agents can file requests using:
          </p>
          <code className="mt-2 block text-xs text-zinc-500">
            forge.request(&quot;Title&quot;, &quot;Description&quot;, &quot;category&quot;)
          </code>
        </div>
      )}
    </div>
  );
}
