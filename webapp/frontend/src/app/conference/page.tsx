// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";

import { ConferenceSubscribe } from "@/components/conference-subscribe";

export const metadata: Metadata = {
  title: "Conference Updates",
  description: "Subscribe for conference announcements.",
};

export default function ConferencePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-zinc-950 text-white">
      <section className="relative flex min-h-screen items-center justify-center px-6 py-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(251,191,36,0.18),transparent_34%),linear-gradient(180deg,rgba(39,39,42,0.85),rgba(9,9,11,1))]" />
        <div className="absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full border border-white/10" />
        <div className="absolute bottom-[-120px] right-[-80px] h-80 w-80 rounded-full border border-amber-300/20" />

        <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <h1 className="text-5xl font-bold leading-[0.95] text-white sm:text-7xl">
            Conference updates
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-300">
            One email when details are ready. No feed, no clutter.
          </p>
          <div className="relative mt-9 w-full">
            <ConferenceSubscribe />
          </div>
        </div>
      </section>
    </main>
  );
}
