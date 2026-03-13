import { loadKnowledgeTopics, loadAgentNotes } from "@/lib/forge";
import { KnowledgeGrid } from "./knowledge-grid";

export const revalidate = 0;

export default function KnowledgePage() {
  const topics = loadKnowledgeTopics();
  const notes = loadAgentNotes();

  return (
    <div>
      <h2 className="text-lg font-semibold text-zinc-100 mb-4">
        Knowledge Base
      </h2>

      {topics.length === 0 && notes.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          No knowledge topics found.
        </div>
      ) : (
        <KnowledgeGrid topics={topics} notes={notes} />
      )}
    </div>
  );
}
