import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWikiIndex } from "@/app/wiki/wikiSources";
import { WikiPageView } from "@/ui-kit/components/wiki/WikiPageView";
import { WikiShell } from "@/ui-kit/components/wiki/WikiShell";

interface WikiToolPageProps {
  params: Promise<{ tool: string }>;
}

export async function generateMetadata({ params }: WikiToolPageProps): Promise<Metadata> {
  const [{ tool: toolSlug }, wikiIndex] = await Promise.all([params, getWikiIndex()]);
  const tool = wikiIndex.findTool(toolSlug);
  return { title: tool ? `${tool.title} | Wiki` : "Wiki" };
}

export default async function WikiToolPage({ params }: WikiToolPageProps) {
  const [{ tool: toolSlug }, wikiIndex] = await Promise.all([params, getWikiIndex()]);
  const tool = wikiIndex.findTool(toolSlug);
  if (!tool) notFound();

  return (
    <WikiShell>
      <WikiPageView
        toolSlug={tool.toolSlug}
        toolTitle={tool.title}
        pages={tool.pages}
        currentPage={wikiIndex.defaultPage(tool.toolSlug)}
      />
    </WikiShell>
  );
}
