"use client";

import { useEffect, useState } from "react";

// Empty on the server and on the first client render, so hydration matches; filled on mount.
export default function Clock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const tick = () => setT(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="clock">{t ? `${t} UTC` : ""}</span>;
}
