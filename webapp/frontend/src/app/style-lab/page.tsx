// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StyleLabClient } from "./style-lab-client";

export const metadata: Metadata = {
  title: "Aries",
  robots: { index: false, follow: false },
};

export default function StyleLabPage() {
  if (process.env.NEXT_PUBLIC_ARIES_STYLE_LAB !== "1") notFound();
  return <StyleLabClient />;
}
