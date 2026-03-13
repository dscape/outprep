import { TaskList } from "@/components/TaskList";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Tasks</h2>
        <p className="text-sm text-zinc-500">
          Tool jobs and permission requests across all agents
        </p>
      </div>

      <TaskList />
    </div>
  );
}
