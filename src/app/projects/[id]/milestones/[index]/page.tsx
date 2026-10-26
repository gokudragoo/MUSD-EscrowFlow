"use client";

import { use } from "react";
import { PageContainer } from "@/components/layout/gate";
import { MilestoneView } from "@/components/project/milestone-view";

export default function MilestonePage({ params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = use(params);
  return (
    <PageContainer>
      <MilestoneView id={id} index={Number(index)} />
    </PageContainer>
  );
}
