import SearchInput from "@/components/SearchInput";
import PGNDropZone from "@/components/PGNDropZone";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            outprep
          </h1>
        </div>

        <SearchInput />

        <div className="my-6 flex items-center gap-3">
          <div className="flex-1 border-t border-zinc-800" />
          <span className="text-sm text-zinc-600">or</span>
          <div className="flex-1 border-t border-zinc-800" />
        </div>

        <PGNDropZone />
      </div>
    </div>
  );
}
