import Link from "next/link";
import SearchInput from "@/components/SearchInput";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-bold text-zinc-700">404</h1>
      <p className="mt-4 text-lg text-zinc-400">
        Page not found
      </p>
      <p className="mt-2 text-sm text-zinc-500 max-w-sm">
        The player or game you&apos;re looking for doesn&apos;t exist or may have been moved.
      </p>

      <div className="mt-8 w-full max-w-md">
        <SearchInput />
      </div>

      <Link
        href="/"
        className="mt-6 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        &larr; Back to home
      </Link>
    </div>
  );
}
