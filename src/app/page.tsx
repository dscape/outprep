import SearchInput from "@/components/SearchInput";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            overprep
          </h1>
        </div>

        <SearchInput />
      </div>
    </div>
  );
}
