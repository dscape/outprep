import SearchInput from "@/components/SearchInput";
import PGNDropZone from "@/components/PGNDropZone";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center px-4">
      <div className="flex flex-1 flex-col items-center justify-center w-full max-w-md text-center">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            outprep
          </h1>
        </div>

        <SearchInput />

        <div className="my-6 flex items-center gap-3 w-full">
          <div className="flex-1 border-t border-zinc-800" />
          <span className="text-sm text-zinc-600">or</span>
          <div className="flex-1 border-t border-zinc-800" />
        </div>

        <PGNDropZone />
      </div>

      <footer className="w-full max-w-lg text-center pb-6 pt-10 space-y-3">
        <p className="text-sm text-zinc-400">
          Have an idea to make outprep better?{" "}
          <a
            href="https://github.com/dscape/outprep/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-500 hover:text-green-400 underline underline-offset-2"
          >
            Suggest an improvement
          </a>
        </p>
        <p className="text-[10px] text-zinc-800">
          Made with &#10084; in Porto. Donations:{" "}
          <span className="font-mono text-zinc-700 break-all">
            0x8EAc5fDF6bFff841964441444d260A66198D9538
          </span>
        </p>
      </footer>
    </div>
  );
}
