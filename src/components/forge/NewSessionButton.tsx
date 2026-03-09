"use client";

import { useState } from "react";
import { NewSessionDialog } from "./NewSessionDialog";

export function NewSessionButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded bg-zinc-700 text-sm text-zinc-100 hover:bg-zinc-600 transition-colors"
      >
        + New Session
      </button>
      {open && <NewSessionDialog onClose={() => setOpen(false)} />}
    </>
  );
}
