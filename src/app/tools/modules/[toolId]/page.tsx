"use client";

import React, { use } from "react";
import { notFound } from "next/navigation";
import { ToolWorkspaceLayout } from "@/components/layout/ToolWorkspaceLayout";
import { moduleRegistry } from "@/services/extensions/moduleRegistry";

export default function DynamicModuleToolPage({
  params,
}: {
  params: Promise<{ toolId: string }>;
}) {
  const { toolId } = use(params);
  const tool = moduleRegistry.getTool(toolId);

  if (!tool) {
    return notFound();
  }

  const Component = tool.component;

  return (
    <ToolWorkspaceLayout
      title={tool.title}
      description={tool.description}
    >
      <Component />
    </ToolWorkspaceLayout>
  );
}
