import type { Metadata } from "next";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { PageHeader } from "@/components/ui/primitives";
import { ProjectForm } from "@/components/project/project-form";

export const metadata: Metadata = { title: "Create a project" };

export default function NewProjectPage() {
  return (
    <SignInGate title="Sign in to create a project">
      <PageContainer>
        <PageHeader
          eyebrow="New agreement"
          title="Create a project"
          description="Define the work, split the budget into milestones and choose the rules the escrow contract will enforce. Nothing is funded until the freelancer has accepted these exact terms."
        />
        <ProjectForm mode="create" />
      </PageContainer>
    </SignInGate>
  );
}
