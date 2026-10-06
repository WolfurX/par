"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseCommand, type CommandCompany } from "./command-parse";

export default function CommandLine({ companies }: { companies: CommandCompany[] }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      e.preventDefault();
      ref.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      className="cmd"
      onSubmit={(e) => {
        e.preventDefault();
        const value = ref.current!.value.trim();
        if (!value) {
          setMsg("");
          return;
        }
        const href = parseCommand(value, companies);
        if (href) {
          setMsg("");
          router.push(href);
        } else {
          // Clear first so a repeated unmatched Enter changes the live region and is announced again.
          setMsg("");
          setTimeout(() => setMsg(`no match: ${value}`), 0);
        }
      }}
    >
      <input
        ref={ref}
        aria-label="Command line"
        placeholder="openai 1000"
        autoComplete="off"
        spellCheck={false}
        onChange={() => setMsg("")}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <p className="cmd-msg" aria-live="polite">
        {msg}
      </p>
    </form>
  );
}
