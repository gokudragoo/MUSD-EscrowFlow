"use client";

import { use } from "react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { MilestoneView } from "@/components/project/milestone-view";

/** Review Submission: the milestone view with review controls first. */
export default function ReviewPage({ params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = use(params);
  return (
    <SignInGate>
      <PageContainer>
        <MilestoneView id={id} index={Number(index)} focus="review" />
      </PageContainer>
    </SignInGate>
  );
}
