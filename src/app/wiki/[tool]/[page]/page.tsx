import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWikiIndex } from "@/app/wiki/wikiSources";
import { WikiPageView } from "@/ui-kit/components/wiki/WikiPageView";
import { WikiShell } from "@/ui-kit/components/wiki/WikiShell";

interface WikiContentPageProps {
  params: Promise<{ tool: string; page: string }>;
}

export async function generateMetadata({ params }: WikiContentPageProps): Promise<Metadata> {
  const [{ tool: toolSlug, page: pageSlug }, wikiIndex] = await Promise.all([params, getWikiIndex()]);
  const tool = wikiIndex.findTool(toolSlug);
  const page = wikiIndex.findPage(toolSlug, pageSlug);
  if (!tool || !page) return { title: "Wiki" };
  return { title: page.title === tool.title ? `${tool.title} | Wiki` : `${page.title} | ${tool.title} | Wiki` };
}

export default async function WikiContentPage({ params }: WikiContentPageProps) {
  const [{ tool: toolSlug, page: pageSlug }, wikiIndex] = await Promise.all([params, getWikiIndex()]);
  const tool = wikiIndex.findTool(toolSlug);
  const page = wikiIndex.findPage(toolSlug, pageSlug);
  if (!tool || !page) notFound();

  return (
    <WikiShell>
      <WikiPageView toolSlug={tool.toolSlug} toolTitle={tool.title} pages={tool.pages} currentPage={page} />
    </WikiShell>
  );
}
