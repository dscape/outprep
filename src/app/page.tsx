import SearchInput from "@/components/SearchInput";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Logo / Title */}
        <div className="mb-8">
          <div className="mb-4 text-5xl">
            <span className="inline-block" role="img" aria-label="chess">&#9816;</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Chess Doppelganger
          </h1>
          <p className="mt-2 text-zinc-400">
            Scout any Lichess player. Practice against their style.
          </p>
        </div>

        {/* Search */}
        <SearchInput />

        {/* How it works */}
        <div className="mt-16 grid gap-6 text-left sm:grid-cols-3">
          <Step
            num={1}
            title="Scout"
            description="Enter a Lichess username to get a full scouting report: openings, style, weaknesses."
          />
          <Step
            num={2}
            title="Practice"
            description="Play against a bot that follows their opening repertoire and matches their strength."
          />
          <Step
            num={3}
            title="Analyze"
            description="Get coaching analysis tied to the opponent's patterns and tendencies."
          />
        </div>
      </div>
    </div>
  );
}

function Step({
  num,
  title,
  description,
}: {
  num: number;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-green-600/20 text-xs font-bold text-green-400">
        {num}
      </div>
      <h3 className="font-medium text-white">{title}</h3>
      <p className="mt-1 text-sm text-zinc-500 leading-relaxed">{description}</p>
    </div>
  );
}
