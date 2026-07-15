// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { FormEvent, useState } from "react";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ConferenceSubscribe() {
  const [submittedEmail, setSubmittedEmail] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    if (!email) {
      return;
    }
    setSubmittedEmail(email);
    event.currentTarget.reset();
  }

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-3 sm:flex-row"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor="conference-email">
        Email address
      </label>
      <Input
        id="conference-email"
        name="email"
        type="email"
        required
        placeholder="Email address"
        className="h-12 rounded-md border-white/15 bg-white px-4 text-base text-zinc-950 placeholder:text-zinc-500 focus-visible:border-amber-300 focus-visible:ring-amber-300/35"
      />
      <Button
        className="h-12 rounded-md bg-amber-300 px-5 text-base font-bold text-zinc-950 hover:bg-amber-200"
        size="lg"
        type="submit"
      >
        <Mail aria-hidden="true" className="size-4" />
        Subscribe
      </Button>
      <p
        aria-live="polite"
        className="min-h-6 text-center text-sm text-zinc-300 sm:absolute sm:mt-14 sm:w-full"
      >
        {submittedEmail ? `Thanks. ${submittedEmail} is on the list.` : ""}
      </p>
    </form>
  );
}
