"use client";

import { use } from "react";
import { PageContainer } from "@/components/layout/gate";
import { ProjectView } from "@/components/project/project-view";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PageContainer>
      <ProjectView id={id} />
    </PageContainer>
  );
}
